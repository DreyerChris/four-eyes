import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactElement } from "react";
import { createQueryClient } from "../api/queryClient";
import { useTheme } from "../api/queries";
import { ReviewPage } from "../features/review/ReviewPage";
import { SummaryPage } from "../features/review/SummaryPage";
import { ListPage } from "../features/shell/list/ListPage";
import { ShellOverlays } from "../features/shell/ShellOverlays";
import { useGlobalKeyListener, useKeyScope } from "../keys/hooks";
import { Link } from "../ui/Link";
import { Panel } from "../ui/Panel";
import { StatusBar } from "../ui/StatusBar";
import styles from "./App.module.css";
import { ErrorBoundary } from "./ErrorBoundary";
import { paths, useRoute, type Route } from "./router";

const scopeFor = (route: Route): "list" | "review" | "summary" =>
  route.name === "review" ? "review" : route.name === "summary" ? "summary" : "list";

const crumbFor = (route: Route): string => {
  switch (route.name) {
    case "list":
      return `reviews / ${route.tab}`;
    case "review":
      return "review";
    case "summary":
      return "summary";
    case "not-found":
      return "not found";
  }
};

const Page = ({ route }: { readonly route: Route }): ReactElement => {
  switch (route.name) {
    case "list":
      return <ListPage tab={route.tab} />;
    case "review":
      return <ReviewPage key={route.reviewId} reviewId={route.reviewId} chunkId={route.chunkId} />;
    case "summary":
      return <SummaryPage key={route.reviewId} reviewId={route.reviewId} />;
    case "not-found":
      return (
        <Panel title="not found">
          <p>No page at {route.path}.</p>
          <Link to={paths.list()}>Back to reviews</Link>
        </Panel>
      );
  }
};

const ThemeSync = (): null => {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
};

const Shell = (): ReactElement => {
  const route = useRoute();
  useGlobalKeyListener();
  useKeyScope(scopeFor(route));
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to={paths.list()} className={styles.brand}>
          four-eyes
        </Link>
        <span className={styles.crumb}>{crumbFor(route)}</span>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <ErrorBoundary label="Page" key={route.name}>
          <Page route={route} />
        </ErrorBoundary>
      </main>
      <ErrorBoundary label="Overlays">
        <ShellOverlays route={route} />
      </ErrorBoundary>
      <StatusBar />
      <ThemeSync />
    </div>
  );
};

export const App = (): ReactElement => {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
};
