# Nexus — The Agentic AI Browser

Beyond Browsing. Agent-driven internet, securely integrated.

Nexus is a powerful, privacy-first desktop browser designed for the era of Agentic AI. It seamlessly combines a high-performance Chromium engine with native AI integration, allowing you to chat with page context, run autonomous web agents, and experience the internet without trackers.

![Project Banner](file:///E:/Tejas/websites/agentic_browser/assets/branding/banner.png)

## 🚀 Key Features

### 🤖 Nexus AI Assistant
- **Immersive Sidebar**: Access your AI assistant without leaving your tab. Now features a **Premium Collapsible Design** to maximize workspace.
- **Page Context Awareness**: Use the "Context" toggle to let the AI read and summarize the current page.
- **Multi-Model Support**: Connect to **OpenRouter**, **Ollama** (Local), or use **Pollinations** for free.
- **Cinematic Fullscreen**: Native support for YouTube and video players with automatic UI hiding for an immersive experience.

### ⚡ Autonomous Web Agents
- **Agent Factory**: Create specialized agents with custom emojis, descriptions, and system instructions.
- **Live Interaction**: Run agents to perform complex multi-step tasks on the web while you watch.
- **Instant Interrupt**: Manually instruct or stop agents at any time.

### 🛡️ Nexus Shields
- **Industrial-Grade Ad-blocking**: Powered by the Ghostery engine.
- **Anti-Fingerprinting**: Blocks passive tracking scripts from identifying your device.
- **HTTPS Upgrade**: Automatically forces secure connections on non-HTTPS sites.
- **Industrial Privacy**: Native blocking of trackers and cross-site scripts.

### 🎨 Free Image Generation
- **Native Generation**: Generate stunning AI images directly in the sidebar via Pollinations.
- **Zero Cost**: No API keys required for basic image generation.

### 📂 Pro Workspace
- **Integrated Notes**: Keep track of ideas with a native markdown notes manager.
- **Modern Bookmarks**: Organize your favorite sites with a sleek, interactive interface and **instant debounced search**.
- **Smart History**: Fully searchable browsing history powered by a robust **SQLite engine** for high-performance persistence.
- **Downloads Manager**: Centralized hub for all session downloads.
- **Unified New Tab**: A high-performance, flicker-free home screen that launches directly into the modern engine.

---

## 🛠️ Technology Stack

- **Runtime**: [Electron](https://www.electronjs.org/) (Chromium)
- **UI Architecture**: Vanilla HTML5 / CSS3 / ES6+ Javascript
- **Persistence**: 
  - [SQLite3](https://www.sqlite.org/) (History & Large datasets)
  - [Electron-Store](https://github.com/sindresorhus/electron-store) (Settings & Model Cache)
- **Privacy Engine**: [@ghostery/adblocker-electron](https://github.com/ghostery/adblocker)
- **AI Routing**: Custom LLM Router supporting Cloud & Local providers.

---

## 🏁 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Ollama](https://ollama.com/) (Optional, for local AI support)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/tejas-soni/Nexus.git
   cd Nexus
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run dev
   ```

---

## ⚙️ Configuration

### 1. OpenRouter (Recommended)
Go to **Settings > AI & Agents**, select **OpenRouter**, and paste your API key. Click **Save Changes** and **Test Connection** to fetch the latest models.

### 2. Local AI (Ollama)
Ensure Ollama is running (`ollama serve`). In Nexus Settings, select **Ollama** as your provider. Nexus will automatically detect your locally pulled models (e.g., `llama3.2`).

### 3. Nexus Protocol
Nexus uses a custom internal protocol for all settings and workspace pages:
- `nexus://settings`
- `nexus://bookmarks`
- `nexus://history`
- `nexus://newtab`

---

Nexus is designed for efficiency. Use these shortcuts to navigate faster:

- **Collapse/Expand Sidebar**: `Ctrl + B`
- **Focus Address Bar**: `Ctrl + L` or `Alt + D`
- **New Tab**: `Ctrl + T`
- **Close Active Tab**: `Ctrl + W`
- **Reopen Closed Tab**: `Ctrl + Shift + T` (Sessions based)
- **Refresh Page**: `Ctrl + R` or `F5`
- **Open History**: `Ctrl + H`
- **Open Bookmarks**: `Ctrl + Shift + O`
- **Fullscreen Video**: `F` (Within players like YouTube)

---

## 🧹 Performing a Fresh Start

If you need to reset Nexus to its factory state (clearing all History, Bookmarks, and AI settings), you can use the built-in utility:

1. Close the Nexus Browser.
2. Run the `reset_nexus.ps1` script in the root directory:
   ```powershell
   ./reset_nexus.ps1
   ```
3. Alternatively, you can manually delete the data folder at:
   - **Windows**: `%APPDATA%/Nexus`
   - **Linux**: `~/.config/Nexus`

---

## 🛡️ Privacy & Security
Nexus is built from the ground up to respect user privacy. Unlike traditional browsers, Nexus does not track your browsing habits or AI interactions. All local data is encrypted at the OS level by Electron-Store, and history is stored in a local SQLite file.

---

## 📄 License
This project is licensed under the MIT License. Developed with ❤️ by the Nexus Team.
