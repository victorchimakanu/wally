/* Loaded only by dev-sim.mjs. Emulates the UI protocol without network wallet access. */
(() => {
  const key = 'wally-ui-simulation-v1';
  let state;
  try { state = JSON.parse(sessionStorage.getItem(key)); } catch {}
  if (!state || !state.chats || !state.chats[state.active]) state = { balance: 1000, active: 'demo', chats: { demo: { messages: [], transfers: [] } } };
  const save = () => sessionStorage.setItem(key, JSON.stringify(state));
  const chat = () => state.chats[state.active];
  const balances = () => [
    { chain: 'arbitrum', token: 'USDT', amount: String(state.balance) },
    { chain: 'arbitrum', token: 'native', amount: '0.01' },
    { chain: 'ethereum', token: 'USDT', amount: '250' },
    { chain: 'ethereum', token: 'native', amount: '0.05' },
    { chain: 'bitcoin', token: 'native', amount: '0.002' },
  ];
  const address = chain => `SIMULATED-${String(chain).toUpperCase()}-ADDRESS-NOT-FOR-DEPOSITS`;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (resource, options = {}) => {
    const path = new URL(String(resource), location.href).pathname;
    let data;
    if (path === '/api/wallet/recovery') data = { pendingBackup: false };
    else if (path === '/api/sessions') data = { activeId: state.active, sessions: Object.entries(state.chats).filter(([, c]) => c.messages.length).map(([id, c]) => ({ id, title: c.messages[0].content.slice(0, 60) })) };
    else if (path === '/api/session/new') {
      state.active = crypto.randomUUID();
      state.chats[state.active] = { messages: [], transfers: [] };
      save(); data = { ok: true };
    } else if (path === '/api/session/switch') {
      const id = JSON.parse(options.body).id;
      if (!state.chats[id]) return new Response('{}', { status: 404 });
      state.active = id; save(); data = { ok: true };
    } else return originalFetch(resource, options);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  class SimSocket {
    static OPEN = 1;
    readyState = 0;
    constructor() {
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
        this.emit({ type: 'connected', networkMode: 'testnet' });
        if (chat().messages.length) this.emit({ type: 'history', messages: chat().messages });
      }, 30);
    }
    emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
    reply(content) {
      chat().messages.push({ role: 'assistant', content }); save();
      this.emit({ type: 'message', content });
    }
    close() { clearTimeout(this.pending?.timer); this.readyState = 3; this.onclose?.(); }
    send(raw) {
      const event = JSON.parse(raw);
      if (event.type === 'get_balance') return this.emit({ type: 'balance', balances: balances() });
      if (event.type === 'get_address') return this.emit({ type: 'address', chain: event.chain, address: address(event.chain) });
      if (['confirm', 'cancel'].includes(event.type)) {
        if (!this.pending || event.token !== this.pending.token || Date.now() > this.pending.expires) return this.reply('Simulation confirmation expired or not found.');
        const pending = this.pending;
        clearTimeout(pending.timer); this.pending = null;
        if (event.type === 'cancel') return this.reply('Simulated transfer cancelled. Fictional balance unchanged.');
        if (pending.amount > state.balance) return this.reply('Insufficient fictional USDT balance.');
        state.balance = Math.round((state.balance - pending.amount) * 1e6) / 1e6;
        chat().transfers.push(`${pending.amount} USDT to ${pending.to} on Arbitrum (SIMULATED)`);
        this.reply(`SIMULATED: sent ${pending.amount} USDT. No transaction was signed or broadcast.`);
        return this.emit({ type: 'balance', balances: balances() });
      }
      if (event.type !== 'message' || typeof event.content !== 'string') return;
      const content = event.content.trim().slice(0, 2000);
      chat().messages.push({ role: 'user', content }); save();
      if (this.pending) return this.reply('Confirm or cancel the pending simulated transfer first.');
      if (/\bbalance\b/i.test(content)) {
        this.emit({ type: 'balance', balances: balances() });
        return this.reply(`Fictional balances: Arbitrum ${state.balance} USDT / 0.01 ETH; Ethereum 250 USDT / 0.05 ETH; Bitcoin 0.002 BTC.`);
      }
      if (/\baddress\b/i.test(content) && !/\bsend\b/i.test(content)) return this.reply(address(/bitcoin/i.test(content) ? 'bitcoin' : /ethereum/i.test(content) ? 'ethereum' : 'arbitrum'));
      if (/\bbridge\b/i.test(content)) return this.reply('Bridge operations are coming soon in the real app; this feature is not implemented.');
      if (/\b(history|last payment)\b/i.test(content)) return this.reply(chat().transfers.join('\n') || 'No simulated transfers in this chat.');
      if (/\b(swap|deposit|borrow|loan|aave|price|repay|withdraw)\b/i.test(content)) return this.reply('This simulator covers balances, addresses, chats and transfer confirmation. Prices, swaps and lending require the real integrations; repay/withdraw are missing from the current app.');
      const match = /^send\s+(\d+(?:\.\d{1,6})?)\s+USDT\s+to\s+(0x[0-9a-fA-F]{40})\s+on\s+arbitrum[.!]?$/i.exec(content);
      if (match && Number(match[1]) > 0) {
        if (Number(match[1]) > state.balance) return this.reply('Insufficient fictional USDT balance.');
        this.pending = { token: crypto.randomUUID(), amount: Number(match[1]), to: match[2], expires: Date.now() + 60000 };
        this.pending.timer = setTimeout(() => { this.pending = null; this.reply('Simulated transfer expired. Fictional balance unchanged.'); }, 60000);
        return this.emit({ type: 'confirmation', payload: { token: this.pending.token, action: 'SIMULATED transfer — no real funds', amount: match[1], token_symbol: 'USDT', recipient: match[2], chain: 'arbitrum', fee: '0 (simulation only)' } });
      }
      this.reply('Scripted demo. Try: what is my balance; history; or send 10 USDT to 0x1111111111111111111111111111111111111111 on arbitrum.');
    }
  }
  window.WebSocket = SimSocket;
})();
