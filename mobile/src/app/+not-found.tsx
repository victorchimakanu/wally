import { router } from 'expo-router';
import { Button, Label, Screen } from '../components/ui';
export default function NotFound() {
  return <Screen title="Let’s get you home"><Label>This screen is not part of the Wally preview.</Label><Button label="Open wallet" onPress={() => router.replace('/wallet')} /></Screen>;
}
