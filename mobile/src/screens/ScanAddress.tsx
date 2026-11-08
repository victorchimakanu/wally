import React, { useCallback, useRef, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { parseScannedAddress } from '../services/qr-address';
import { CHAINS, type Chain } from '../services/wallet-api';
import { colors as c } from '../theme';

/**
 * Scan a recipient address.
 *
 * Typing a 42-character address by hand is the likeliest way a user of this app loses money
 * (FEATURE-AUDIT §3.3), and this is the cheapest thing that removes it.
 *
 * The scan fills **the address only**. An EIP-681 code can carry an amount and this screen
 * deliberately ignores it — the whole app is built on code and the user picking every number —
 * but it says so when a code had one, rather than dropping it silently and leaving somebody to
 * wonder why the figure did not carry over.
 *
 * A code that names a different chain switches the chain, because the code is explicit about
 * which network it is for and that is better information than whichever tab happened to be
 * open. The Send screen says it switched.
 */
export function ScanAddressScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState('');
  // A camera fires this many times a second. Without a latch the first good code navigates
  // while later frames keep firing into an unmounting screen.
  const handled = useRef(false);

  const onScan = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;
    const scanned = parseScannedAddress(data);
    if (!scanned.ok) {
      // Not latched: a refusal should let the user keep pointing the camera at something else.
      setProblem(scanned.reason);
      return;
    }
    handled.current = true;
    router.replace({
      pathname: '/send',
      params: {
        recipient: scanned.address,
        ...(scanned.chain ? { chain: scanned.chain, scannedChain: scanned.chain } : {}),
        ...(scanned.hadAmount ? { scannedAmountIgnored: '1' } : {}),
      },
    });
  }, []);

  if (!permission) {
    return <Screen title="Scan an address"><Card><Label weight="semibold">Checking the camera…</Label></Card></Screen>;
  }

  if (!permission.granted) {
    return <Screen title="Scan an address">
      <Card>
        <Label size={18} weight="semibold">Wally needs the camera</Label>
        <Note>Only to read a QR code containing a wallet address. Nothing is recorded, and nothing leaves this phone.</Note>
        {!permission.canAskAgain && <Note error>Camera access was turned off for Wally. You can switch it back on in your phone’s settings.</Note>}
      </Card>
      {permission.canAskAgain && <Button label="Allow the camera" onPress={() => { void requestPermission(); }} />}
      <Button secondary label="Type the address instead" onPress={() => router.replace('/send')} />
    </Screen>;
  }

  return <Screen title="Scan an address" subtitle="Point at the recipient’s QR code">
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ aspectRatio: 1, backgroundColor: c.ink }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          // QR only. Accepting every symbology would mean reading barcodes off packaging and
          // then explaining why they are not addresses.
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
      </View>
    </Card>

    {!!problem && <Card>
      <Pill tone="warning">Not a usable address</Pill>
      <Note error>{problem}</Note>
      <Note>Keep the camera pointed at a different code, or type the address instead.</Note>
    </Card>}

    <Note>The address is filled in for you. The amount is always yours to type, even if the code contains one.</Note>
    <Button secondary label="Type the address instead" onPress={() => router.replace('/send')} />
  </Screen>;
}

/** Exported for the Send screen's notice, so the two describe a chain the same way. */
export function chainLabel(chain: Chain): string {
  return CHAINS[chain].name;
}
