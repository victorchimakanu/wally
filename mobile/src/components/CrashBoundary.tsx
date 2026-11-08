import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Label, Note, Screen } from './ui';
import { recordCrash } from '../services/crash-log-device';
import { buildInfo, supportSummary } from '../services/build-info';

/**
 * A render crash shows a screen instead of a white rectangle, and is written down.
 *
 * Without this, a thrown error during render unmounts the tree and leaves a blank app. The user
 * sees nothing, learns nothing, and has nothing to tell anyone. On a wallet that is worse than
 * a visible failure: a blank screen after tapping Confirm is indistinguishable from a transfer
 * that went through.
 *
 * So the copy says the one thing that matters first — nothing moved — and then offers the
 * report. It follows the house rule for errors: say what was *not* done, and that funds are
 * untouched.
 *
 * A class component because React offers no hook for this; `componentDidCatch` is the only way.
 */
type Props = React.PropsWithChildren;
type State = { crashed: boolean; message: string };

export class CrashBoundary extends React.Component<Props, State> {
  override state: State = { crashed: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { crashed: true, message: error instanceof Error ? error.message : 'Something went wrong.' };
  }

  override componentDidCatch(error: unknown) {
    const info = buildInfo({ appVersion: Constants.expoConfig?.version, os: Platform.OS, isDevelopment: __DEV__ });
    void recordCrash('render', error, supportSummary(info));
  }

  override render() {
    if (!this.state.crashed) return this.props.children;
    return <Screen title="Something broke" subtitle="Your money is untouched" back={false}>
      <Card>
        <Label size={16} weight="medium">Nothing was sent</Label>
        <Note>This screen failed to load. No transfer was submitted and nothing was changed —
        a problem here cannot move money.</Note>
      </Card>
      <Card>
        <Label size={12} weight="semibold">WHAT HAPPENED</Label>
        <Label size={13} selectable>{this.state.message}</Label>
        <Note>A record was saved on this phone. Settings → Problem reports has it, with
        anything sensitive removed, and you choose whether to send it to anyone.</Note>
      </Card>
      <Button label="Try again" onPress={() => this.setState({ crashed: false, message: '' })} />
    </Screen>;
  }
}
