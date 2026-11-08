import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Label } from './ui';
import { colors as c, fonts } from '../theme';

/** The local model runs without reasoning output, so these steps describe the app's own progress. */
const STEPS: [number, (location: string) => string][] = [
  [0, () => 'Reading your request'],
  [1200, location => location === 'phone' ? 'Thinking on this phone' : location === 'computer' ? 'Thinking on your computer' : 'Thinking'],
  [4000, () => 'Putting the answer together'],
  [9000, () => 'Still working · Local models can take a moment'],
];

function Dot({ index, still }: { index: number; still: boolean }) {
  const level = useSharedValue(still ? 1 : .3);
  useEffect(() => {
    if (still) { level.value = 1; return; }
    level.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(.3, { duration: 420 })), -1));
  }, [index, still, level]);
  const style = useAnimatedStyle(() => ({ opacity: level.value, transform: [{ scale: .7 + level.value * .3 }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.orange }, style]} />;
}

/** Replaces the reply while Wally works: one animated status line, then the reply as it streams in. */
export function ThinkingIndicator({ location, preview }: { location: string; preview: string }) {
  const still = useReducedMotion();
  const [step, setStep] = useState(0);
  const [caret, setCaret] = useState(true);
  const pulse = useSharedValue(1);
  useEffect(() => { const timers = STEPS.slice(1).map(([at], index) => setTimeout(() => setStep(index + 1), at)); return () => timers.forEach(clearTimeout); }, []);
  useEffect(() => { if (!still) pulse.value = withRepeat(withSequence(withTiming(.45, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true); }, [still, pulse]);
  useEffect(() => { if (!preview || still) return; const timer = setInterval(() => setCaret(value => !value), 530); return () => clearInterval(timer); }, [preview, still]);
  const shimmer = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (preview) return <Label size={16} accessibilityLiveRegion="polite" style={{ lineHeight: 22 }}>{preview}<Label size={16} color={caret ? c.orange : 'transparent'}> ▍</Label></Label>;
  const label = STEPS[step][1](location);
  return <Animated.View entering={still ? undefined : FadeIn.duration(220).delay(120)} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 }}>
    <View style={{ flexDirection: 'row', gap: 4 }}>{[0, 1, 2].map(index => <Dot key={index} index={index} still={still} />)}</View>
    <Animated.View key={step} entering={still ? undefined : FadeInDown.duration(260)} style={{ flexShrink: 1 }}><Animated.Text style={[{ fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: c.muted }, shimmer]}>{label}</Animated.Text></Animated.View>
  </Animated.View>;
}
