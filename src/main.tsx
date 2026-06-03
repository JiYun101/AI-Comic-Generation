import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";

const queryClient = new QueryClient();

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App crashed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f2ed] p-6 text-zinc-950">
        <div className="w-full max-w-2xl rounded-lg border bg-white p-5 shadow-sm">
          <div className="text-lg font-semibold">客户端启动失败</div>
          <p className="mt-2 text-sm text-zinc-600">前端运行时发生错误。下面是具体原因，可以先清空本地草稿后重启。</p>
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-white">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          <button
            className="mt-4 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white"
            onClick={() => {
              localStorage.removeItem("ai-comic-studio:draft:v1");
              window.location.reload();
            }}
          >
            清空本地草稿并重启
          </button>
        </div>
      </div>
    );
  }
}

async function boot() {
  const { App } = await import("./App");

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

void boot();
