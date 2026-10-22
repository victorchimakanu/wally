import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Label, shared } from './ui';
import { WallyAsset } from './WallyAsset';
import { colors as c, fonts } from '../theme';

export type ChatSuggestion = { label: string; action: () => void };

/**
 * Figma composer: Empty/Active, Focused, Typing and Replying share one input.
 * Suggestions stay out of the way while the user reads or types: they appear when the input is
 * focused or the screen has been `idle`, as a list, or as one row of chips when space is `compact`.
 */
export function ChatComposer({ value = '', onChange, onSend, onStop, onTools, onPrivacy, busy = false, paused = false, privacy = 'SCRIPTED PREVIEW', suggestions = [], compact = false, idle = false }: {
  value?: string; onChange?: (text: string) => void; onSend?: () => void; onStop?: () => void;
  onTools?: () => void; onPrivacy?: () => void; busy?: boolean;
  paused?: boolean; privacy?: string; suggestions?: ChatSuggestion[]; compact?: boolean; idle?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  // Blur lands before a tap on a suggestion; keep suggestions mounted long enough for the tap.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const [inputHeight, setInputHeight] = useState(23);
  const [width, setWidth] = useState(400);
  const expanded = focused || !!value || busy;
  const landscape = width >= 820;
  const showSuggestions = !value && !busy && suggestions.length > 0 && (focused || idle);
  const disabled = !busy && (!value.trim() || paused);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ gap: landscape ? 16 : 12 }}>
    {showSuggestions && (compact ? <Animated.View entering={FadeInDown.duration(220)}><ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>{suggestions.map(item => <Pressable key={item.label} accessibilityRole="button" onPress={item.action} style={s.chip}><Label size={14} numberOfLines={1}>{item.label}</Label></Pressable>)}</ScrollView></Animated.View>
      : <Animated.View entering={FadeInDown.duration(220)} style={{ paddingHorizontal: width < 600 ? 8 : 0, flexDirection: landscape ? 'row' : 'column', gap: landscape ? 16 : 0 }}>{suggestions.map((item, index) => <Pressable key={item.label} accessibilityRole="button" onPress={item.action} style={[shared.between, { flex: landscape ? 1 : undefined, minHeight: 44, paddingVertical: 10, borderBottomWidth: landscape || index < suggestions.length - 1 ? 1 : 0, borderColor: c.line }]}><Label size={16} style={{ flex: 1, lineHeight: 20 }}>{item.label}</Label><WallyAsset name={width < 600 ? '5162a.svg' : '70f1a.svg'} /></Pressable>)}</Animated.View>)}
    <View style={[s.composer, expanded ? s.expanded : s.idle]}>
      <TextInput accessibilityLabel="Message Wally" value={value} onChangeText={onChange} placeholder={paused ? 'Chat paused' : busy && !value ? 'Wally is replying…' : 'Chat with Wally'} placeholderTextColor="#A0A7A3" editable={!paused} multiline maxLength={1000} returnKeyType="send" submitBehavior="submit" blurOnSubmit={Platform.OS === 'web'} onSubmitEditing={() => { if (!busy && value.trim()) onSend?.(); }} onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); }} onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 200); }} onContentSizeChange={event => setInputHeight(Math.min(115, Math.max(23, event.nativeEvent.contentSize.height)))} style={[s.input, { height: expanded ? Math.max(23, inputHeight) : 23, textAlign: expanded ? 'left' : 'right', paddingLeft: expanded ? 0 : 46 }]} />
      <View style={[s.controls, !expanded && s.idleControls]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open wallet tools" onPress={onTools} hitSlop={5} style={s.attachment}><WallyAsset name="e9d52.svg" /></Pressable>
        {expanded && <><View style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel="Assistant connection details" onPress={onPrivacy} style={s.privacy}><WallyAsset name="2733f.svg" /><Label size={10} weight="semibold" color={c.muted} numberOfLines={1}>{privacy}</Label></Pressable><Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Cancel AI request' : 'Send message'} accessibilityState={{ disabled }} disabled={disabled} onPress={busy ? onStop : onSend} style={[s.action, { opacity: disabled ? .35 : 1 }]}>{busy ? <View style={s.stop} /> : <WallyAsset name="187ef.svg" />}</Pressable></>}
      </View>
    </View>
  </View>;
}
const s = StyleSheet.create({
  composer: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 33, boxShadow: '0 10px 25px #1F292414', position: 'relative' },
  // Idle: one text line centred in the pill, the + button on the same centre line.
  idle: { paddingHorizontal: 24, paddingVertical: 16, minHeight: 68, justifyContent: 'center' }, expanded: { paddingLeft: 24, paddingRight: 10, paddingTop: 16, paddingBottom: 10, gap: 15 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.ink, padding: 0, textAlignVertical: 'top', width: '100%', minWidth: 0, maxHeight: 115 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }, idleControls: { position: 'absolute', left: 19, top: 0, bottom: 0, minHeight: 44 },
  attachment: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, justifyContent: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 136 },
  action: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.orange, alignItems: 'center', justifyContent: 'center' }, stop: { width: 16, height: 16, borderRadius: 3, backgroundColor: c.surface },
});
