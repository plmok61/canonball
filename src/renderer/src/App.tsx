import ChatPlaceholder from './chat/ChatPlaceholder'

function App(): React.JSX.Element {
  return (
    <div className="app">
      <aside data-testid="tree-panel" />
      <main data-testid="editor-panel" />
      <aside data-testid="chat-panel">
        <ChatPlaceholder />
      </aside>
    </div>
  )
}

export default App
