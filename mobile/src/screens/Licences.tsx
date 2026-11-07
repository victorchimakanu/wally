import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Button, Card, Label, Note, Screen, shared } from '../components/ui';
import { WallyAsset } from '../components/WallyAsset';
import { allNotices, licenceSummary, noticeText, searchNotices, type Notice } from '../services/notices';
import { colors as c, fonts } from '../theme';

/**
 * The open source licences the app is obliged to show.
 *
 * `npm run notices` has been generating this data since the licensing change, and until now
 * **nothing rendered it** — which satisfies no obligation at all. Apache-2.0, which
 * `@tetherto/wdk` and 181 other production dependencies use, requires that a distributed work
 * carry the licence and any notices; MIT and BSD require the copyright line and the permission
 * notice. Shipping without a screen that shows them is a compliance problem on the day the app
 * is distributed, and both stores expect this screen to exist.
 *
 * **Why it is a search and not a list.** 742 rows is not something anyone scrolls, and
 * rendering them all inside the app's `Screen` — a ScrollView, so a FlatList cannot be nested
 * in it — would cost a visible stall on a cheap phone for a screen opened once. The two things
 * a person actually arrives wanting are "is <package> in here" and "show me everything under
 * <licence>". Both are one query. The full list is still reachable by paging, because
 * "everything is listed" is the point of the screen.
 */

/** Rendered at a time. Enough to look like a list, few enough to stay instant. */
const PAGE = 25;

function NoticeRow({ notice, open, onToggle }: { notice: Notice; open: boolean; onToggle: () => void }) {
  const text = open ? noticeText(notice) : null;
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={shared.row}>
      <View style={shared.flex}>
        <Label weight="medium">{notice.name}</Label>
        <Label size={11} color={c.muted}>{notice.version ? `${notice.version} · ` : ''}{notice.license}</Label>
      </View>
      <Label size={12} color={c.muted}>{open ? 'Hide' : 'Show'}</Label>
    </Pressable>
    {open && <>
      {!!notice.homepage && <Label size={11} color={c.muted} selectable>{notice.homepage}</Label>}
      {text
        ? <Label size={11} color={c.muted} selectable style={{ fontFamily: fonts.regular, lineHeight: 17 }}>{text}</Label>
        // Said plainly rather than papered over. A package that ships no licence file is a
        // fact about the dependency tree, and inventing text for it would be worse than
        // admitting it: the SPDX identifier above is what the package itself declares.
        : <Note>This package ships no licence file. It declares {notice.license} and the identifier above is what it states.</Note>}
    </>}
  </Card>;
}

export function LicencesScreen() {
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const total = allNotices().length;
  const matches = useMemo(() => searchNotices(search), [search]);
  const page = matches.slice(0, shown);
  const summary = useMemo(() => licenceSummary(), []);

  function onSearch(next: string) {
    setSearch(next);
    // A new query starts at the top, otherwise a narrow search inherits a deep page and looks
    // like it found more than it did.
    setShown(PAGE);
    setOpen(null);
  }

  return <Screen title="Open source licences" subtitle={`${total} packages`}>
    <Card>
      <Label size={16}>Wally is built on {total} open source packages.</Label>
      <Note>Their licences require that we carry this notice. Nothing here is about you or your wallet — it is a list of the software the app is made of.</Note>
      <Label size={11} color={c.muted}>{summary.slice(0, 5).map(s => `${s.license} ${s.count}`).join(' · ')}</Label>
    </Card>

    <View style={[shared.row, shared.input]}>
      <WallyAsset name="ddc2c.svg" />
      <TextInput
        accessibilityLabel="Search packages and licences"
        value={search}
        onChangeText={onSearch}
        placeholder="Search a package or a licence"
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, fontSize: 16, fontFamily: fonts.regular, color: c.ink }}
      />
    </View>

    {/* The count is shown even when nothing is filtered, so "742 packages" is verifiable
        rather than a claim in a sentence above. */}
    <Label size={12} color={c.muted}>
      {matches.length === total ? `Showing ${page.length} of ${total}` : `${matches.length} of ${total} match “${search.trim()}”`}
    </Label>

    {page.map(notice => <NoticeRow
      key={notice.name}
      notice={notice}
      open={open === notice.name}
      onToggle={() => setOpen(open === notice.name ? null : notice.name)}
    />)}

    {!matches.length && <Card>
      <Label weight="semibold">No matching package</Label>
      <Note>Try part of a package name, or a licence like MIT, Apache-2.0 or ISC.</Note>
    </Card>}

    {shown < matches.length && <Button
      secondary
      label={`Show ${Math.min(PAGE, matches.length - shown)} more`}
      onPress={() => setShown(shown + PAGE)}
    />}

    <Note>This list is generated from the app’s production dependencies, not written by hand, so it cannot drift out of date without the build changing.</Note>
  </Screen>;
}
