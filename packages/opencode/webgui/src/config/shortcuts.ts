export interface ShortcutDefinition {
  id: string
  keys: string[]
  description: string
  category: "常规" | "消息" | "导航"
  handler: string
  modKey?: boolean
  shiftKey?: boolean
  key: string
}

export const KEYBOARD_SHORTCUTS: ShortcutDefinition[] = [
  // General
  {
    id: "command-palette",
    keys: ["Cmd/Ctrl", "K"],
    description: "打开命令面板",
    category: "常规",
    handler: "onOpenCommandPalette",
    modKey: true,
    key: "k",
  },
  {
    id: "new-session",
    keys: ["Cmd/Ctrl", "N"],
    description: "新建会话",
    category: "常规",
    handler: "onNewSession",
    modKey: true,
    key: "n",
  },
  {
    id: "settings",
    keys: ["Cmd/Ctrl", ","],
    description: "打开设置",
    category: "常规",
    handler: "onOpenSettings",
    modKey: true,
    key: ",",
  },
  {
    id: "help",
    keys: ["?"],
    description: "查看键盘快捷键",
    category: "常规",
    handler: "onShowHelp",
    shiftKey: true,
    key: "?",
  },
  {
    id: "close-modal",
    keys: ["Escape"],
    description: "关闭弹窗或对话框",
    category: "常规",
    handler: "onCloseModal",
    key: "Escape",
  },

  // Messages
  {
    id: "send-message",
    keys: ["Enter"],
    description: "发送消息",
    category: "消息",
    handler: "onSendMessage",
    key: "Enter",
  },

  // Navigation
  {
    id: "toggle-session-list",
    keys: ["Cmd/Ctrl", "B"],
    description: "切换会话列表",
    category: "导航",
    handler: "onToggleSessionList",
    modKey: true,
    key: "b",
  },
]
