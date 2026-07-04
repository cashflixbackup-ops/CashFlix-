const express = require('express');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID || '8897413984';
const POSTBACK_TOKEN = process.env.POSTBACK_TOKEN || 'cashf';

const offerConfig = {
  'Waves': { installAmt: 0.1, trialAmt: 3, installBalance: false, trialBalance: true, installComment: 'Waves install', trialComment: 'Waves Signup' },
  'PolicyBazar': { installAmt: 0.1, trialAmt: 5, installBalance: false, trialBalance: true, installComment: 'PolicyBazar install', trialComment: 'PolicyBazar Register' },
  'Muthoot': { installAmt: 0.1, trialAmt: 15, installBalance: false, trialBalance: true, installComment: 'Muthoot Install', trialComment: 'Muthoot Register' },
  'Jigri Super': { installAmt: 0.1, trialAmt: 45, installBalance: false, trialBalance: true, installComment: 'JIGRI Install', trialComment: 'JIGRI Deposit' },
  'FRIENDSHIP': { installAmt: 0.1, trialAmt: 43, installBalance: false, trialBalance: true, installComment: 'FriendShip Install', trialComment: 'FriendShip Deposit' },
  'Incred Gold': { installAmt: 0.1, trialAmt: 22, installBalance: false, trialBalance: true, installComment: 'Incred Install', trialComment: 'Incred Gold' },
  'StoryTv Fire': { installAmt: 0.1, trialAmt: 22, installBalance: false, trialBalance: true, installComment: 'StoryTv Install', trialComment: 'StoryTv Trail' }
};

const rateLimitMap = {};
function rateLimit(ip, limit = 10, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimitMap[ip]) rateLimitMap[ip] = [];
  rateLimitMap[ip] = rateLimitMap[ip].filter(t => now - t < windowMs);
  if (rateLimitMap[ip].length >= limit) return false;
  rateLimitMap[ip].push(now);
  return true;
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function isValidUPI(upi) {
  return /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/.test(upi);
}

function isValidIFSC(ifsc) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
}

function getTime() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }).replace(',', '');
}

async function sendMsg(chat_id, text, keyboard = null) {
  for (let i = 0; i < 3; i++) {
    try {
      const body = { chat_id, text, parse_mode: 'HTML' };
      if (keyboard) body.reply_markup = { keyboard, resize_keyboard: true };
      const res = await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) break;
    } catch(e) {
      if (i === 2) console.error('sendMsg failed:', e);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function sendInlineMsg(chat_id, text, inline_keyboard) {
  await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard } })
  });
}

async function editMsg(chat_id, message_id, text, inline_keyboard) {
  await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard } })
  });
}

async function answerAlert(callback_query_id, text) {
  await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id, text, show_alert: true })
  });
}

async function dbGet(table, filter) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function dbPost(table, data) {
  await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
}

async function dbPatch(table, filter, data) {
  await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

const mainKeyboard = [['💰 Withdraw', '👤 Profile']];
const contactKeyboard = {
  keyboard: [[{ text: '📱 Share Contact', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true
};
const userState = {};

setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimitMap) {
    rateLimitMap[ip] = rateLimitMap[ip].filter(t => now - t < 60000);
    if (rateLimitMap[ip].length === 0) delete rateLimitMap[ip];
  }
  for (const chat_id in userState) {
    if (userState[chat_id]?.timestamp && now - userState[chat_id].timestamp > 30 * 60 * 1000) {
      delete userState[chat_id];
    }
  }
  console.log('Memory cleanup done ✅');
}, 30 * 60 * 1000);

app.post('/webhook', async (req, res) => {
  try {
    res.sendStatus(200);
    const { message, callback_query } = req.body;

    if (callback_query) {
      const chat_id = callback_query.from.id.toString();
      const data = callback_query.data;
      const message_id = callback_query.message?.message_id;

      if (data === 'set_upi') {
        await answerAlert(callback_query.id, '');
        const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
        if (users.length > 0 && users[0].upi_id) {
          await editMsg(chat_id, message_id,
            `<b>💸 UPI Details:</b>\n\n<b>UPI ID: ${users[0].upi_id}</b>`,
            [[{ text: '✏️ Update', callback_data: 'update_upi' }]]
          );
        } else {
          userState[chat_id] = { state: 'set_upi', message_id: null, timestamp: Date.now() };
          await sendMsg(chat_id, `<b>Please enter your UPI ID\n\nExample: john.doe@okaxis</b>`);
        }

      } else if (data === 'update_upi') {
        await answerAlert(callback_query.id, '');
        userState[chat_id] = { state: 'set_upi', message_id: null, timestamp: Date.now() };
        await sendMsg(chat_id, `<b>Please enter your new UPI ID\n\nExample: john.doe@okaxis</b>`);

      } else if (data === 'set_bank') {
        await answerAlert(callback_query.id, '');
        const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
        if (users.length > 0 && users[0].bank_account) {
          await editMsg(chat_id, message_id,
            `<b>🏦 Bank Details:</b>\n\n<b>Account: ${users[0].bank_account}</b>\n<b>IFSC: ${users[0].bank_ifsc}</b>`,
            [[{ text: '✏️ Update', callback_data: 'update_bank' }]]
          );
        } else {
          userState[chat_id] = { state: 'set_bank_account', message_id: null, timestamp: Date.now() };
          await sendMsg(chat_id, `<b>Please enter your account number:</b>`);
        }

      } else if (data === 'update_bank') {
        await answerAlert(callback_query.id, '');
        userState[chat_id] = { state: 'set_bank_account', message_id: null, timestamp: Date.now() };
        await sendMsg(chat_id, `<b>Please enter your new account number:</b>`);

      } else if (data === 'withdraw_upi') {
        await answerAlert(callback_query.id, '');
        const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
        if (users.length > 0) {
          const u = users[0];
          if (parseFloat(u.balance) >= 50) {
            userState[chat_id] = { state: 'withdraw_amount', method: 'upi', payment: u.upi_id, message_id, timestamp: Date.now() };
            await editMsg(chat_id, message_id, `<b>💸 Enter withdrawal amount (Min: ₹50):</b>`, []);
          } else {
            await sendMsg(chat_id, `<b>❌ Minimum ₹50 Required!</b>`, mainKeyboard);
          }
        }

      } else if (data === 'withdraw_bank') {
        await answerAlert(callback_query.id, '');
        const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
        if (users.length > 0) {
          const u = users[0];
          if (parseFloat(u.balance) >= 50) {
            userState[chat_id] = { state: 'withdraw_amount', method: 'bank', payment: `${u.bank_account} / ${u.bank_ifsc}`, message_id, timestamp: Date.now() };
            await editMsg(chat_id, message_id, `<b>💸 Enter withdrawal amount (Min: ₹50):</b>`, []);
          } else {
            await sendMsg(chat_id, `<b>❌ Minimum ₹50 Required!</b>`, mainKeyboard);
          }
        }

      } else if (data === 'confirm_withdraw') {
        await answerAlert(callback_query.id, '');
        const state = userState[chat_id];
        if (!state) return;
        const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
        if (users.length > 0) {
          const u = users[0];
          const amt = state.amount;
          if (parseFloat(u.balance) < amt) {
            await sendMsg(chat_id, `<b>❌ Insufficient balance!</b>`, mainKeyboard);
            delete userState[chat_id];
            return;
          }
          const newBal = parseFloat(u.balance) - amt;
          await dbPatch('users', `telegram_id=eq.${chat_id}`, { balance: newBal });
          const requestId = Math.floor(10000 + Math.random() * 90000).toString();
          await dbPost('withdrawals', {
            telegram_id: chat_id,
            request_id: requestId,
            amount: amt,
            method: state.method,
            upi_id: state.method === 'upi' ? state.payment : null,
            bank_account: state.method === 'bank' ? state.payment.split(' / ')[0] : null,
            bank_ifsc: state.method === 'bank' ? state.payment.split(' / ')[1] : null,
            status: 'pending'
          });
          await editMsg(chat_id, message_id,
            `<b>✅ Withdrawal Submitted!\n\n📊 Request ID: ${requestId}\n💰 Amount: ₹${amt}\n💳 Payment: ${state.payment}\n\n⏳ Processing: 24-48 hours</b>`, []
          );
          await sendInlineMsg(ADMIN_ID,
            `<b>💸 Withdraw Request\n\n📊 Request ID: ${requestId}\n👤 User: ${u.name || 'User'}\n📱 Phone: ${u.phone}\n💰 Amount: ₹${amt}\n💳 Payment: ${state.payment}</b>`,
            [
              [{ text: '✅ Approve', callback_data: `admin_approve_${requestId}` }],
              [{ text: '❌ Cancel', callback_data: `admin_cancel_${requestId}` }]
            ]
          );
          delete userState[chat_id];
        }

      } else if (data === 'cancel_withdraw') {
        await answerAlert(callback_query.id, '❌ Cancelled!');
        delete userState[chat_id];
        await editMsg(chat_id, message_id, `<b>❌ Withdrawal Cancelled!</b>`, []);

      } else if (data === 'check_status') {
        const withdrawals = await dbGet('withdrawals', `telegram_id=eq.${chat_id}&order=created_at.desc&limit=1`);
        if (withdrawals.length > 0) {
          const w = withdrawals[0];
          await answerAlert(callback_query.id, `CashFlix Wallet ⚡\nStatus: ${w.status.charAt(0).toUpperCase() + w.status.slice(1)}`);
        } else {
          await answerAlert(callback_query.id, 'CashFlix Wallet ⚡\nNo requests found!');
        }

      } else if (data.startsWith('admin_approve_')) {
        if (chat_id !== ADMIN_ID) {
          await answerAlert(callback_query.id, '❌ Unauthorized!');
          return;
        }
        const requestId = data.replace('admin_approve_', '');
        const withdrawals = await dbGet('withdrawals', `request_id=eq.${requestId}`);
        if (withdrawals.length > 0) {
          const w = withdrawals[0];
          if (w.status !== 'pending') {
            await answerAlert(callback_query.id, '⚠️ Already processed!');
            return;
          }
          await dbPatch('withdrawals', `request_id=eq.${requestId}`, { status: 'paid' });
          await editMsg(ADMIN_ID, message_id,
            `<b>💸 Withdraw Request\n\n📊 Request ID: ${requestId}\n💰 Amount: ₹${w.amount}\n💳 Payment: ${w.upi_id || w.bank_account}\n\n✅ Approved</b>`, []
          );
          await sendMsg(w.telegram_id, `<b>✅ Withdrawal of ₹${parseFloat(w.amount).toFixed(2)} approved!</b>`);
          await answerAlert(callback_query.id, '✅ Approved!');
        }

      } else if (data.startsWith('admin_cancel_')) {
        if (chat_id !== ADMIN_ID) {
          await answerAlert(callback_query.id, '❌ Unauthorized!');
          return;
        }
        const requestId = data.replace('admin_cancel_', '');
        const withdrawals = await dbGet('withdrawals', `request_id=eq.${requestId}`);
        if (withdrawals.length > 0) {
          const w = withdrawals[0];
          if (w.status !== 'pending') {
            await answerAlert(callback_query.id, '⚠️ Already processed!');
            return;
          }
          await dbPatch('withdrawals', `request_id=eq.${requestId}`, { status: 'cancelled' });
          const users = await dbGet('users', `telegram_id=eq.${w.telegram_id}`);
          if (users.length > 0) {
            const refundBal = parseFloat(users[0].balance) + parseFloat(w.amount);
            await dbPatch('users', `telegram_id=eq.${w.telegram_id}`, { balance: refundBal });
          }
          await editMsg(ADMIN_ID, message_id,
            `<b>💸 Withdraw Request\n\n📊 Request ID: ${requestId}\n💰 Amount: ₹${w.amount}\n💳 Payment: ${w.upi_id || w.bank_account}\n\n❌ Cancelled</b>`, []
          );
          await sendMsg(w.telegram_id, `<b>❌ Withdrawal cancelled. ₹${parseFloat(w.amount).toFixed(2)} refunded!</b>`);
          await answerAlert(callback_query.id, '❌ Cancelled!');
        }

      } else {
        await answerAlert(callback_query.id, '');
      }
      return;
    }

    if (!message) return;

    const chat_id = message.chat.id.toString();
    const text = message.text || '';

    if (message.contact) {
      const phone = message.contact.phone_number.replace(/\D/g, '').slice(-10);
      const name = message.contact.first_name || 'User';
      if (message.contact.user_id && message.contact.user_id.toString() !== chat_id) {
        await sendMsg(chat_id, `<b>❌ Please share your own contact!</b>`);
        return;
      }
      const existing = await dbGet('users', `phone=eq.${phone}`);
      if (existing.length > 0 && existing[0].telegram_id !== chat_id) {
        await sendMsg(chat_id, `<b>❌ Phone already registered!</b>`);
        return;
      }
      await dbPost('users', { telegram_id: chat_id, name, phone, balance: 0, lifetime_earnings: 0 });
      await sendMsg(chat_id, `<b>✅ Registration successful!\n\n👤 Profile\n\n🙌🏻 User: ${name} ⚡\n💰 Balance: ₹0.00\n🪢 Lifetime Earnings: ₹0.00\n📱 Phone: ${phone}</b>`, mainKeyboard);
      return;
    }

    if (text === '/start') {
      const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
      if (users.length === 0) {
        await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id,
            text: `<b>👋 Welcome! Please share your phone number:</b>`,
            parse_mode: 'HTML',
            reply_markup: contactKeyboard
          })
        });
      } else {
        const u = users[0];
        await sendMsg(chat_id, `<b>👤 Profile\n\n🧑 User: ${u.name || 'User'} ⚡\n💰 Balance: ₹${parseFloat(u.balance || 0).toFixed(2)}\n🔁 Lifetime Earnings: ₹${parseFloat(u.lifetime_earnings || 0).toFixed(2)}\n📱 Phone: ${u.phone || 'N/A'}</b>`, mainKeyboard);
      }

    } else if (text === '👤 Profile') {
      const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
      if (users.length > 0) {
        const u = users[0];
        await sendInlineMsg(chat_id,
          `<b>👤 Profile\n\n🙌🏻 User: ${u.name || 'User'} ⚡\n💰 Balance: ₹${parseFloat(u.balance || 0).toFixed(2)}\n🪢 Lifetime Earnings: ₹${parseFloat(u.lifetime_earnings || 0).toFixed(2)}\n📱 Phone: ${u.phone || 'N/A'}</b>`,
          [
            [{ text: '💸 UPI', callback_data: 'set_upi' }],
            [{ text: '🏦 Bank Details', callback_data: 'set_bank' }]
          ]
        );
      }

    } else if (text === '💰 Withdraw') {
      const users = await dbGet('users', `telegram_id=eq.${chat_id}`);
      if (users.length > 0) {
        const u = users[0];
        if (!u.upi_id && !u.bank_account) {
          await sendInlineMsg(chat_id,
            `<b>💰 Withdraw\n\nPlease add payment method first:</b>`,
            [
              [{ text: '💸 Add UPI', callback_data: 'set_upi' }],
              [{ text: '🏦 Add Bank', callback_data: 'set_bank' }]
            ]
          );
        } else if (u.upi_id && u.bank_account) {
          await sendInlineMsg(chat_id,
            `<b>💰 Withdraw\n\nBalance: ₹${parseFloat(u.balance || 0).toFixed(2)}\n\nChoose payment method:</b>`,
            [
              [{ text: '💸 UPI', callback_data: 'withdraw_upi' }],
              [{ text: '🏦 Bank', callback_data: 'withdraw_bank' }],
              [{ text: '📊 Check Status', callback_data: 'check_status' }]
            ]
          );
        } else if (u.upi_id) {
          await sendInlineMsg(chat_id,
            `<b>💰 Withdraw\n\nBalance: ₹${parseFloat(u.balance || 0).toFixed(2)}</b>`,
            [
              [{ text: '💸 Withdraw via UPI', callback_data: 'withdraw_upi' }],
              [{ text: '📊 Check Status', callback_data: 'check_status' }]
            ]
          );
        } else {
          await sendInlineMsg(chat_id,
            `<b>💰 Withdraw\n\nBalance: ₹${parseFloat(u.balance || 0).toFixed(2)}</b>`,
            [
              [{ text: '🏦 Withdraw via Bank', callback_data: 'withdraw_bank' }],
              [{ text: '📊 Check Status', callback_data: 'check_status' }]
            ]
          );
        }
      }

    } else if (userState[chat_id]) {
      const state = userState[chat_id].state;

      if (state === 'set_upi') {
        if (isValidUPI(text)) {
          await dbPatch('users', `telegram_id=eq.${chat_id}`, { upi_id: text });
          delete userState[chat_id];
          await sendMsg(chat_id, `<b>✅ UPI ID updated: ${text}</b>`, mainKeyboard);
        } else {
          await sendMsg(chat_id, `<b>❌ Invalid UPI! Example: john.doe@okaxis</b>`);
        }

      } else if (state === 'set_bank_account') {
        if (/^\d{9,18}$/.test(text)) {
          userState[chat_id] = { state: 'set_bank_ifsc', account: text, timestamp: Date.now() };
          await sendMsg(chat_id, `<b>🏦 Enter IFSC code:</b>`);
        } else {
          await sendMsg(chat_id, `<b>❌ Invalid account number!</b>`);
        }

      } else if (state === 'set_bank_ifsc') {
        if (isValidIFSC(text)) {
          const account = userState[chat_id].account;
          await dbPatch('users', `telegram_id=eq.${chat_id}`, { bank_account: account, bank_ifsc: text.toUpperCase() });
          delete userState[chat_id];
          await sendMsg(chat_id, `<b>✅ Bank updated!\n\n🏦 Account: ${account}\n📋 IFSC: ${text.toUpperCase()}</b>`, mainKeyboard);
        } else {
          await sendMsg(chat_id, `<b>❌ Invalid IFSC! Example: SBIN0001234</b>`);
        }

      } else if (state === 'withdraw_amount') {
        const 
