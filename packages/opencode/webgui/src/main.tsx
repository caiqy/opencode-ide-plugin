import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { ideBridge } from "./lib/ideBridge"
import { installTooltipPolyfillBridge } from "./lib/tooltipPolyfill"
import { uiBridgeEnable, uiBridgeHydrate } from "./state/uiBridgeState"
import { SessionProvider } from "./state/SessionContext.tsx"
import { ToastProvider } from "./state/ToastContext.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary.tsx"
import { ProjectProvider } from "./state/ProjectContext.tsx"
import { IdeBridgeProvider } from "./state/IdeBridgeContext"
import { ProvidersProvider } from "./state/ProvidersContext"
import { initGlobalDnD } from "./lib/dnd"

window.addEventListener(
  "opencode:ui-bridge-state",
  (ev) => {
    const state = (ev as CustomEvent<{ state?: unknown }>).detail?.state
    if (state) uiBridgeHydrate(state)
    uiBridgeEnable()
  },
  { once: true },
)

ideBridge.init()
installTooltipPolyfillBridge()
initGlobalDnD()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ProjectProvider>
        <SessionProvider>
          <ToastProvider>
            <IdeBridgeProvider>
              <ProvidersProvider>
                <App />
              </ProvidersProvider>
            </IdeBridgeProvider>
          </ToastProvider>
        </SessionProvider>
      </ProjectProvider>
    </ErrorBoundary>
  </StrictMode>,
)
