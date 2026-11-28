import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Keyboard, Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button, Card, Label, LinkButton, NetworkBadge, Note, Screen, useShared } from '../components/ui';
import { WalletOverview } from '../components/WalletOverview';
import { useShell } from '../components/shell';
import { ChatComposer, type ChatSuggestion } from '../components/ChatComposer';
import { ChatContextCard, DraftChatCard, InlineChatTool, ToolStateCard, WalletToolsModal } from '../components/ChatCards';
import { ChatHistoryPanel } from '../components/ChatHistoryPanel';
import { ThinkingIndicator } from '../components/ThinkingIndicator';
import { Lockup } from '../components/WallyAsset';
import { draftStatus, type Message } from '../demo/model';
import { useDemo } from '../demo/store';
import { useColors } from '../theme';
import { useWallet } from '../data/wallet';
import { useMarket } from '../data/market';
import { chatSuggestions, primarySuggestion, type Suggestion, type SuggestionAction } from '../services/chat-suggestions';

/** Quiet time before suggestions offer themselves without the user focusing the input. */
const IDLE_MS = 6000;

export function ChatScreen() {
  const { id, prompt, topic } = useLocalSearchParams<{ id: string; prompt?: string; topic?: string }>();
  return <Conversation key={id} id={id} prompt={prompt} topic={topic} />;
}
function Conversation({ id, prompt, topic }: { id: string; prompt?: string; topic?: string }) {
  const c = useColors();
  const shared = useShared();
  const wallet = useWallet();
  const { wide, gutter } = useShell();
  const { data: market } = useMarket();
  const { state, ai, quote, cancelAi, sendMessage, prepare, cancel, confirm, setDraft, newChat, discardDraft, updateChatDraft, update } = useDemo();
  const busy = ai.status === 'working' && ai.busyChatId === id;
  const requestBlocked = ai.status === 'working';
  const [input, setInput] = useState(prompt ?? '');
  const [error, setError] = useState('');
  const [tools, setTools] = useState(false);
  const [history, setHistory] = useState(false);
  const [nearLatest, setNearLatest] = useState(true);
  const [jump, setJump] = useState(0);
  const [editRequest, setEditRequest] = useState({ id: '', sequence: 0 });
  const [viewportHeight, setViewportHeight] = useState(700);
  const [now, setNow] = useState(Date.now);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rest = useCallback(() => { clearTimeout(idleTimer.current); idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS); }, []);
  const wake = useCallback(() => { setIdle(false); rest(); }, [rest]);
  const chat = state.chats.find(item => item.id === id);
  const messages = chat?.messages ?? [];
  const last = messages.at(-1);
  const currentDraft = messages.findLast(message => message.draft && draftStatus(message) === 'active');
  const lastRequest = messages.findLast(message => message.role === 'user');
  const turns: Message[][] = [];
  for (const message of messages) { if (message.role === 'user' || !turns.length) turns.push([]); turns.at(-1)!.push(message); }
  useEffect(() => { if (!quote?.origin || quote.origin.chatId !== id) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [quote, id]);
  // Scrolling, typing, sending and replies all count as activity and hide suggestions again.
  const activity = `${messages.length}:${busy}:${input}`;
  const [seenActivity, setSeenActivity] = useState(activity);
  if (seenActivity !== activity) { setSeenActivity(activity); setIdle(false); }
  useEffect(() => { rest(); return () => clearTimeout(idleTimer.current); }, [rest, activity]);
  function send(text = input) {
    if (!chat || !text.trim() || requestBlocked) return;
    if (sendMessage(chat.id, text)) { setInput(''); setError(''); setTools(false); setHistory(false); setJump(value => value + 1); }
  }
  function review(message: Message) { const failure = prepare(message.draft!, { chatId: id, messageId: message.id }); setError(failure ?? ''); setNow(() => Date.now()); }
  function sendTransfer() { const result = confirm(); setError(result.error ?? ''); }
  function manual(recipient = '', amount = '') { if (wallet.enabled) { router.push({ pathname: '/send', params: { recipient } }); return; } setDraft({ recipient, amount }); router.push('/send'); }
  function retry() { if (lastRequest) send(lastRequest.text); }
  function act(action: SuggestionAction) {
    if (action.kind === 'send') send(action.text);
    else router.replace({ pathname: action.pathname, params: action.params });
  }
  const suggest = (item: Suggestion): ChatSuggestion => ({ label: item.label, action: () => act(item.action) });
  const recent = state.chats.find(item => item.id !== id && item.messages.length);
  const start = chatSuggestions({ topic, live: wallet.enabled, wallet: wallet.snapshot, history: wallet.history, market: market?.assets ?? [], recent: recent && { id: recent.id, title: recent.title }, asked: messages.filter(message => message.role === 'user').map(message => message.text) }).map(suggest);
  let suggestions = start;
  // Every follow-up answers inside this chat; cards hold the detail instead of other screens.
  const ask = (label: string, text = label): ChatSuggestion => ({ label, action: () => send(text) });
  const kind = last?.tool?.kind;
  if (kind === 'receive') suggestions = [ask('Show my balances', 'What is my balance?'), ask('Show receive address', 'What is my Arbitrum address?'), currentDraft ? { label: 'Open current draft', action: () => review(currentDraft) } : ask('Show my recent transactions', 'Show my transaction history')];
  else if (kind === 'balances') suggestions = [ask('Choose display currency'), suggest(primarySuggestion({ live: wallet.enabled, wallet: wallet.snapshot })), ask('Show my recent transactions', 'Show my transaction history')];
  else if (kind === 'market') suggestions = [ask('Explain Bitcoin'), ask('Show top movers'), ask('Show my balances', 'What is my balance?')];
  else if (kind === 'asset' || kind === 'movers') suggestions = [kind === 'asset' ? ask('Show top movers') : ask('Explain Bitcoin'), ask('Show today’s crypto market', 'Show crypto market'), ask('Show my balances', 'What is my balance?')];
  else if (kind === 'currency') suggestions = [ask('Show today’s crypto market', 'Show crypto market'), ask('Show top movers'), ask('Show my balances', 'What is my balance?')];
  else if (kind === 'unavailable' || state.aiPaused) suggestions = [ask('Show my balances', 'What is my balance?'), ask('View my activity', 'Show my transaction history'), ask('Show receive address', 'What is my Arbitrum address?')];
  else if (currentDraft) suggestions = [{ label: 'Explain the network fee', action: () => send('Explain the network fee for this transfer') }, { label: 'Change this transfer', action: () => { cancel(); setEditRequest(value => ({ id: currentDraft.id, sequence: value.sequence + 1 })); } }, { label: 'Cancel this draft', action: () => discardDraft(id, currentDraft.id) }];
  const privacy = ai.mode === 'qvac' ? ai.location === 'phone' ? 'ON THIS PHONE' : 'ON YOUR COMPUTER' : 'SCRIPTED PREVIEW';
  // Once a conversation starts the chat takes the screen: on a phone the bar above gives way to a
  // floating menu button, and older messages fade out under it.
  const immersive = messages.length > 0;
  // History and new chat live in the composer's tools sheet, where the drawer and sidebar also
  // offer them; only the desktop heading row shows them inline, beside the badge.
  // The desktop heading carries only the badge: New chat and the chats list are in the sidebar,
  // and the history panel opens from the aside's button.
  const toolbar = wide || history ? <>{wide && <View style={[shared.row, { justifyContent: 'space-between', paddingHorizontal: gutter, paddingTop: 48, minHeight: 64 }]}><Label size={25} weight="semibold" accessibilityRole="header" style={{ lineHeight: 31 }}>Chat</Label><NetworkBadge /></View>}{history && <ChatHistoryPanel height={viewportHeight * .5} onClose={() => setHistory(false)} />}</> : undefined;
  // Desktop keeps the wallet in view beside the conversation, as the desktop chat design does.
  const aside = wide ? <><WalletOverview /><Button secondary label="Chats and transactions" onPress={() => { Keyboard.dismiss(); setHistory(!history); }} /></> : undefined;
  // The stack's slide does not run on the web, so the conversation eases in on its own rather
  // than snapping into place after the Market composer or the switch.
  return <Animated.View entering={FadeIn.duration(260)} style={{ flex: 1 }}><Screen surface="chat" immersive={immersive} autoScroll fixedHeader={toolbar} aside={aside} scrollRequest={`${id}:${lastRequest?.id ?? 'empty'}:${jump}`} onScrollActivity={wake} onNearBottomChange={setNearLatest} onViewportHeightChange={setViewportHeight} contentStyle={{ justifyContent: 'flex-end', paddingTop: !wide && immersive ? 76 : 8, paddingBottom: 16, gap: 24 }} footer={<>
    {!nearLatest && <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest request" onPress={() => setJump(value => value + 1)} style={{ alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.tint, borderRadius: 20 }}><Label size={12}>Latest request ↓</Label></Pressable>}
    <ChatComposer value={input} onChange={setInput} onSend={() => send()} onStop={cancelAi} onTools={() => { Keyboard.dismiss(); setTools(true); }} onPrivacy={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} busy={busy} paused={state.aiPaused || !chat || (requestBlocked && !busy)} privacy={privacy} suggestions={history ? [] : suggestions} idle={idle} compact={viewportHeight < 520} />
    {state.aiPaused && <View style={[shared.row, { justifyContent: 'center', gap: 16 }]}><Label size={13} color={c.muted}>Chat is paused</Label><LinkButton label="Resume" onPress={() => update({ aiPaused: false })} /></View>}
  </>}>
    {state.offline && <Card style={{ backgroundColor: c.warningTint }}><Label weight="semibold">You’re offline</Label><Note>Drafts are available. Reconnect before reviewing a transfer.</Note></Card>}
    {!chat && <><Label>This conversation is no longer available.</Label><Button label="Start a new chat" onPress={() => router.replace({ pathname: '/chat', params: { id: newChat() } })} /></>}
    {/* A chat opened from a screen carries that screen above its first turn; one without starts with the prompt. */}
    {chat?.context && <ChatContextCard context={chat.context} />}
    {chat?.messages.length === 0 && !chat.context && <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}><Lockup size={150} style={{ alignSelf: 'center' }} /><Label size={28} weight="semibold" style={shared.center}>What can I help with?</Label></View>}
    {/* One reading size for both voices, 16 on 24: a pale bubble for what you said, plain text for the reply. */}
    {turns.map((turn, index) => <View key={turn[0].id} style={{ gap: 12 }}>{turn.map(message => message.role === 'user' ? <View key={message.id} accessibilityLabel="Your request" style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: c.tint, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12 }}><Label size={16} style={{ lineHeight: 24, overflowWrap: 'anywhere' } as never}>{message.text}</Label></View> : <View key={message.id} style={{ gap: 12 }}>
      <Label size={16} style={{ lineHeight: 24 }}>{message.text}</Label>
      {message.draft && (wallet.enabled ? <Card><Label weight="semibold">Saved demo draft</Label><Note>This fictional USDt draft cannot be submitted to the connected testnet wallet.</Note><Button secondary label="Open testnet Send" onPress={() => manual()} /></Card> : <DraftChatCard message={message} quote={quote?.origin?.chatId === id && quote.origin.messageId === message.id ? quote : null} now={now} editRequest={editRequest.id === message.id ? editRequest.sequence : 0} onReview={() => review(message)} onCancelReview={cancel} onConfirm={sendTransfer} onEdit={draft => updateChatDraft({ chatId: id, messageId: message.id }, draft)} />)}
      {message.tool && <InlineChatTool tool={message.tool} onRetry={retry} onManual={manual} onAsk={send} />}
    </View>)}
    {index === turns.length - 1 && busy && <ThinkingIndicator location={ai.location} preview={ai.preview} />}
    </View>)}
    {!!error && <ToolStateCard kind={/balance/i.test(error) ? 'insufficient' : 'blocked'} detail={error} onAction={() => manual(currentDraft?.draft?.recipient, currentDraft?.draft?.amount)} />}
    {state.aiPaused && <Button secondary label="Use manual send" onPress={() => manual()} />}
    <WalletToolsModal visible={tools} onClose={() => setTools(false)} onManual={() => manual()} onNewChat={() => router.replace({ pathname: '/chat', params: { id: newChat() } })} onHistory={() => setHistory(true)} />
  </Screen></Animated.View>;
}
