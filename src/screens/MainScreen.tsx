import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, // indicate the APP state, 'active'(foreground), 'background', 'inactive'
  BackHandler,
  Keyboard,
  Pressable,
  Text,
  View,
} from 'react-native';
import { runTurn } from '../agent/turn';
import {
  errorMessage,
  type Conversation,
  type Message,
  type ModelSettings,
} from '../agent/types';
import {
  deleteConversation,
  emptyConversation,
  loadConversation,
  saveConversation,
} from '../storage/conversations';
import { NavigationDrawer, type Screen } from '../components/NavigationDrawer';
import { ChatScreen } from './ChatScreen';
import { SettingsScreen } from './SettingsScreen';
import { FactsScreen } from './FactsScreen';
import { HistoryScreen } from './HistoryScreen';
import { ToolsScreen } from './ToolsScreen';
import { BrowserScreen } from './BrowserScreen';
import { BrowserController } from '../browser/controller';
import { ScreenController } from '../device/screen';
import { useScreenAccess } from '../device/use-screen-access';
import { useScreenAccessPrompt } from '../device/screen-prompt';
import { useTheme } from '../components/theme';

export function MainScreen({
  initialConversation,
  initialSettings,
}: {
  initialConversation: Conversation;
  initialSettings: ModelSettings;
}) {
  const theme = useTheme();
  const [browser] = useState(() => new BrowserController());
  const [screenAccess] = useState(() => new ScreenController());
  const access = useScreenAccess(screenAccess);
  // A refused tool call is the moment the ask makes sense, so the banner waits for it.
  const accessPrompt = useScreenAccessPrompt();
  const [settings, setSettings] = useState(initialSettings);
  const [screen, setScreen] = useState<Screen>('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState(initialConversation.messages);
  const [conversationId, setConversationId] = useState(initialConversation.id);
  const [conversationStatus, setConversationStatus] = useState(
    initialConversation.status,
  );
  // is the agent in `runTurn()`?
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    initialConversation.status === 'interrupted'
      ? 'Previous run was interrupted. You can send a new message.'
      : '',
  );
  const [error, setError] = useState('');
  // current conversation
  const conversation = useRef(initialConversation);
  // control the turn abort
  const controller = useRef<AbortController | null>(null);
  // indicate the new conversation is creating, preventing creating repeatly
  const creatingChat = useRef(false);
  // for updating the messages
  const pending = useRef<Message[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) setMessages(pending.current);
    pending.current = null;
  }, []);
  const publish = (next: Message[]) => {
    pending.current = next;
    if (!timer.current) timer.current = setTimeout(flush, 50);
  };
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      // Operating another app puts MaLiu in the background by design.
      if (
        state !== 'active' &&
        controller.current &&
        !screenAccess.actingInOtherApps
      ) {
        controller.current.abort(
          new Error('Stopped because the app moved to the background.'),
        );
      }
    });
    const stopListener = screenAccess.onStop(() =>
      controller.current?.abort(new Error('Stopped from the notification.')),
    );
    return () => {
      listener.remove();
      stopListener();
      controller.current?.abort(new Error('Stopped.'));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [screenAccess]);

  useEffect(() => {
    if (screen === 'chat') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('chat');
      return true;
    });
    return () => listener.remove();
  }, [screen]);

  const send = async (prompt: string, synthetic = false) => {
    if (controller.current || creatingChat.current) return;
    const run = new AbortController(); // every send needs an AbortController
    controller.current = run;
    setBusy(true);
    setError('');
    setStatus('Starting…');
    try {
      const result = await runTurn({
        conversation: conversation.current,
        prompt,
        synthetic,
        settings,
        browser,
        screen: screenAccess,
        signal: run.signal,
        onMessages: publish,
        onStatus: setStatus,
        onConversation: (next) => {
          conversation.current = next;
          setConversationStatus(next.status);
        },
      });
      if (result.status === 'waiting') {
        setStatus('Waiting for you in the browser.');
        setScreen('browser');
      } else setStatus('');
    } catch (e) {
      if (run.signal.aborted) setStatus(errorMessage(run.signal.reason));
      else {
        setError(errorMessage(e));
        setStatus('');
      }
    } finally {
      flush(); // update the screen
      controller.current = null; // delete the controller
      setBusy(false);
      // Bring MaLiu back from the app it worked in, so the answer is on screen.
      void screenAccess
        .finish()
        .catch((e: unknown) => setError(errorMessage(e)));
    }
  };
  const showConversation = (next: Conversation) => {
    flush();
    if (conversation.current.id !== next.id) setDraft('');
    conversation.current = next;
    setConversationId(next.id);
    setConversationStatus(next.status);
    setMessages(next.messages);
    setStatus(
      next.status === 'interrupted' ? 'Previous run was interrupted.' : '',
    );
    setError('');
  };
  const openConversation = async (id: string) => {
    showConversation(await loadConversation(id));
    setScreen('chat');
  };
  const newChat = async () => {
    if (controller.current || creatingChat.current) return;
    creatingChat.current = true;
    setBusy(true);
    try {
      const next = emptyConversation();
      await saveConversation(next);
      showConversation(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      creatingChat.current = false;
      setBusy(false);
    }
  };
  const openMenu = () => {
    Keyboard.dismiss();
    setMenuOpen(true);
  };
  const backToChat = () => setScreen('chat');
  const handoffMessage =
    conversationStatus === 'waiting'
      ? messages.findLast(
          (message) =>
            message.toolName === 'browser_handoff' && !message.isError,
        )
      : undefined;
  const handoff = handoffMessage
    ? (JSON.parse(handoffMessage.content) as { url: string; reason: string })
    : undefined;
  let content;
  switch (screen) {
    case 'settings':
      content = (
        <SettingsScreen
          settings={settings}
          access={access}
          onMenu={openMenu}
          onBack={backToChat}
          onSaved={(next) => {
            setSettings(next);
            setScreen('chat');
          }}
        />
      );
      break;
    case 'history':
      content = (
        <HistoryScreen
          onMenu={openMenu}
          onBack={backToChat}
          onOpen={openConversation}
          onDelete={async (id) => {
            await deleteConversation(id);
            if (conversation.current.id === id) {
              const next = emptyConversation();
              await saveConversation(next);
              showConversation(next);
            }
          }}
        />
      );
      break;
    case 'facts':
      content = (
        <FactsScreen
          onMenu={openMenu}
          onBack={backToChat}
          onOpen={openConversation}
        />
      );
      break;
    case 'tools':
      content = <ToolsScreen onMenu={openMenu} onBack={backToChat} />;
      break;
  }
  return (
    <View style={{ flex: 1 }}>
      {/* Preserve a laid-out WebView when chat is visible, including its login session. */}
      <View
        pointerEvents={screen === 'browser' ? 'auto' : 'none'}
        accessibilityElementsHidden={screen !== 'browser'}
        importantForAccessibility={
          screen === 'browser' ? 'auto' : 'no-hide-descendants'
        }
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          opacity: screen === 'browser' ? 1 : 0,
        }}
      >
        <BrowserScreen
          browser={browser}
          busy={busy}
          handoff={handoff}
          onMenu={openMenu}
          onBack={backToChat}
          onContinue={() => {
            setScreen('chat');
            void send(
              'I have finished the browser handoff. Read the current page and continue the task.',
              true,
            );
          }}
          onStop={() =>
            controller.current?.abort(
              new Error(
                'Browser control handed to you. Send a message when ready to continue.',
              ),
            )
          }
        />
      </View>
      {/* Keep the active chat mounted so navigation preserves its reading position. */}
      <View
        style={{ flex: 1, display: screen === 'chat' ? 'flex' : 'none' }}
        accessibilityElementsHidden={screen !== 'chat'}
        importantForAccessibility={
          screen === 'chat' ? 'auto' : 'no-hide-descendants'
        }
      >
        <ChatScreen
          key={conversationId}
          messages={messages}
          model={settings.model}
          access={access}
          accessPrompt={accessPrompt}
          enabled={!!settings.apiKey && !!settings.model}
          busy={busy}
          status={status}
          error={error}
          draft={draft}
          onDraftChange={setDraft}
          onMenu={openMenu}
          onNewChat={() => void newChat()}
          onSend={(text) => void send(text)}
          onStop={() => controller.current?.abort(new Error('Stopped.'))}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setScreen('browser')}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.surface,
          }}
        >
          <Text style={{ color: theme.accent }}>
            {handoff ? 'Continue in browser' : 'Open browser'}
          </Text>
        </Pressable>
      </View>
      {content}
      <NavigationDrawer
        visible={menuOpen}
        screen={screen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(next) => {
          setScreen(next);
          setMenuOpen(false);
        }}
      />
    </View>
  );
}
