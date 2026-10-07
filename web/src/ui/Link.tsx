import type { MouseEvent, ReactElement, ReactNode } from "react";
import { navigate } from "../app/router";

export interface LinkProps {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/** In-app link that uses the history router; modifier-clicks fall through to the browser. */
export const Link = ({ to, children, className }: LinkProps): ReactElement => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
};
