import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import {
  BrowserController,
  browserUrl,
  type BrowserAction,
  type BrowserArgs,
} from '../browser/controller';
import { browserPageScript } from '../browser/page-script';
import { ScreenHeader } from '../components/ScreenHeader';
import { useTheme } from '../components/theme';
import { errorMessage } from '../agent/types';
import { withTimeout } from '../agent/timeout';

export function BrowserScreen({
  browser,
  busy,
  handoff,
  onMenu,
  onBack,
  onContinue,
  onStop,
}: {
  browser: BrowserController;
  busy: boolean;
  handoff?: { url: string; reason: string };
  onMenu: () => void;
  onBack: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const theme = useTheme();
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const view = useRef<WebView<unknown> | null>(null);
  const [source, setSource] = useState({ uri: 'about:blank' });
  const sourceUrl = useRef(source.uri);
  const [address, setAddress] = useState('');
  const [desktop, setDesktop] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const disabled = busy || working;
  const chrome = state.userAgent.match(/Chrome\/[\d.]+/)?.[0];
  const desktopAgent = chrome
    ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
    : undefined;

  const navigate = useCallback(
    (url: string) => {
      if (url === sourceUrl.current) {
        if (url === browser.getSnapshot().url) view.current?.reload();
        else
          view.current?.injectJavaScript(
            `location.assign(${JSON.stringify(url)}); true;`,
          );
      } else {
        sourceUrl.current = url;
        setSource({ uri: url });
      }
    },
    [browser],
  );
  const attach = useCallback(
    (native: WebView<unknown> | null) => {
      view.current = native;
      browser.attach(
        native
          ? {
              navigate,
              injectJavaScript: (script) => native.injectJavaScript(script),
              // Native back can skip history entries created without a user gesture.
              goBack: () => native.injectJavaScript('history.back(); true;'),
              stopLoading: () => native.stopLoading(),
            }
          : undefined,
      );
    },
    [browser, navigate],
  );
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    // The updated UA prop is committed before reloading the current document.
    if (browser.getSnapshot().url !== 'about:blank') view.current?.reload();
  }, [browser, desktop]);

  const run = async (action: BrowserAction, args: BrowserArgs = {}) => {
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setWorking(true);
    setError('');
    try {
      if (args.url) args.url = browserUrl(args.url);
      // The agent's tool timeout does not cover manual browsing.
      await withTimeout(controller.signal, 25_000, (signal) =>
        browser.execute(action, args, signal),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      operation.current = null;
      setWorking(false);
    }
  };
  const follow = (url: string) => {
    if (/^https?:\/\//i.test(url)) {
      browser.loadStarted();
      navigate(url);
    } else browser.update({ externalUrl: url });
  };
  const openApp = async () => {
    try {
      let url = state.externalUrl;
      if (url.startsWith('intent://')) {
        const scheme = /;scheme=([^;]+);/.exec(url)?.[1];
        if (!scheme)
          throw new Error(
            'This app link cannot be opened. Try another sign-in method.',
          );
        url = `${scheme}://${url.slice('intent://'.length).split('#Intent;')[0]}`;
      }
      if (/^(javascript|file|content|data|about):/i.test(url))
        throw new Error('This link cannot be opened outside the browser.');
      await Linking.openURL(url);
      browser.update({ externalUrl: '' });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Browser"
        busy={busy}
        onMenu={onMenu}
        action={{ label: 'Chat', onPress: onBack }}
      />
      <View style={styles.addressRow}>
        <TextInput
          accessibilityLabel="Website address"
          value={address}
          onChangeText={setAddress}
          placeholder="https://example.com"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          editable={!disabled}
          onSubmitEditing={() =>
            void run('open', {
              url: address.includes('://') ? address : `https://${address}`,
            })
          }
          style={[
            styles.address,
            { color: theme.text, borderColor: theme.border },
          ]}
        />
        <BrowserButton
          label="Go"
          disabled={disabled}
          onPress={() =>
            void run('open', {
              url: address.includes('://') ? address : `https://${address}`,
            })
          }
        />
      </View>
      <View style={styles.toolbar}>
        <BrowserButton
          label="Back"
          disabled={disabled || !state.canGoBack}
          onPress={() => void run('back')}
        />
        <BrowserButton
          label="Reload"
          disabled={disabled}
          onPress={() => {
            setError('');
            view.current?.reload();
          }}
        />
        <Text style={{ color: theme.muted, marginLeft: 'auto' }}>
          Desktop site
        </Text>
        <Switch
          accessibilityLabel="Request desktop site"
          value={desktop}
          disabled={disabled}
          onValueChange={setDesktop}
        />
      </View>
      {handoff && (
        <View style={[styles.notice, { backgroundColor: theme.user }]}>
          <Text style={{ color: theme.text }}>{handoff.reason}</Text>
          <View style={styles.toolbar}>
            {state.url === 'about:blank' && /^https?:/.test(handoff.url) && (
              <BrowserButton
                label="Open saved page"
                disabled={disabled}
                onPress={() => void run('open', { url: handoff.url })}
              />
            )}
            <BrowserButton
              label="Continue"
              disabled={
                disabled || state.loading || state.url === 'about:blank'
              }
              onPress={onContinue}
            />
          </View>
        </View>
      )}
      {busy && (
        <View style={styles.toolbar}>
          <Text style={{ color: theme.muted }}>
            Agent is using the browser.
          </Text>
          <BrowserButton label="Take over" onPress={onStop} />
        </View>
      )}
      {!!state.externalUrl && (
        <View style={styles.notice}>
          <Text style={{ color: theme.muted }}>
            This page requested an external app. You can open it during manual
            sign-in.
          </Text>
          <BrowserButton
            label="Open app"
            disabled={disabled}
            onPress={() => void openApp()}
          />
        </View>
      )}
      {!!(error || state.error) && (
        <Text
          accessibilityRole="alert"
          style={[styles.notice, { color: theme.error }]}
        >
          {error || state.error}
        </Text>
      )}
      {state.loading && (
        <ActivityIndicator
          accessibilityLabel="Loading page"
          color={theme.accent}
          style={{ padding: 4 }}
        />
      )}
      <View style={{ flex: 1 }} pointerEvents={busy ? 'none' : 'auto'}>
        <WebView<unknown>
          ref={attach}
          source={source}
          style={{ flex: 1 }}
          userAgent={desktop ? desktopAgent : undefined}
          scalesPageToFit
          domStorageEnabled
          thirdPartyCookiesEnabled
          originWhitelist={['*']}
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically
          onShouldStartLoadWithRequest={(request) => {
            if (
              /^https?:\/\//i.test(request.url) ||
              request.url === 'about:blank'
            )
              return true;
            browser.update({ externalUrl: request.url });
            return false;
          }}
          onOpenWindow={({ nativeEvent }) => follow(nativeEvent.targetUrl)}
          onLoadStart={({ nativeEvent }) => {
            // Android also emits this for pushState/hash history changes, without onLoad.
            if (nativeEvent.loading) browser.loadStarted();
            else view.current?.injectJavaScript(browserPageScript);
          }}
          onNavigationStateChange={(event) => {
            if (event.url !== browser.getSnapshot().url)
              setAddress(event.url === 'about:blank' ? '' : event.url);
            browser.update({
              url: event.url,
              title: event.title,
              canGoBack: event.canGoBack,
            });
          }}
          onLoad={() => {
            const viewport = desktop
              ? `let meta = document.querySelector('meta[name="viewport"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); } meta.content = 'width=1280';`
              : '';
            view.current?.injectJavaScript(
              `(() => { ${viewport} })(); ${browserPageScript}`,
            );
          }}
          onMessage={({ nativeEvent }) => browser.receive(nativeEvent.data)}
          onError={({ nativeEvent }) => browser.fail(nativeEvent.description)}
          onRenderProcessGone={() =>
            browser.fail(
              'Browser renderer stopped. Reload the page to continue.',
            )
          }
        />
      </View>
    </View>
  );
}

function BrowserButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={{ color: theme.accent, opacity: disabled ? 0.4 : 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  address: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  notice: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 13 },
});
