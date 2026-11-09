import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, // indicate the APP state, 'active'(foreground), 'background', 'inactive'
  BackHandler,
  Keyboard,
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
import { MemoryScreen } from './MemoryScreen';
import { HistoryScreen } from './HistoryScreen';
import { ToolsScreen } from './ToolsScreen';

export function MainScreen({
  initialConversation,
  initialSettings,
}: {
  initialConversation: Conversation;
  initialSettings: ModelSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [screen, setScreen] = useState<Screen>('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState(initialConversation.messages);
  const [conversationId, setConversationId] = useState(initialConversation.id);
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
      if (state !== 'active' && controller.current) {
        controller.current.abort(
          new Error('Stopped because the app moved to the background.'),
        );
      }
    });
    return () => {
      listener.remove();
      controller.current?.abort(new Error('Stopped.'));
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (screen === 'chat') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('chat');
      return true;
    });
    return () => listener.remove();
  }, [screen]);

  const send = async (prompt: string) => {
    if (controller.current || creatingChat.current) return;
    const run = new AbortController(); // every send needs an AbortController
    controller.current = run;
    setBusy(true);
    setError('');
    setStatus('Starting…');
    try {
      await runTurn({
        conversation: conversation.current,
        prompt,
        settings,
        signal: run.signal,
        onMessages: publish,
        onStatus: setStatus,
        onConversation: (next) => {
          conversation.current = next;
        },
      });
      setStatus('');
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
    }
  };
  const showConversation = (next: Conversation) => {
    flush();
    if (conversation.current.id !== next.id) setDraft('');
    conversation.current = next;
    setConversationId(next.id);
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
  let content;
  switch (screen) {
    case 'settings':
      content = (
        <SettingsScreen
          settings={settings}
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
    case 'memory':
      content = (
        <MemoryScreen
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
