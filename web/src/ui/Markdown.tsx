import type { ReactElement, ReactNode } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "./markdown-parse";
import styles from "./Markdown.module.css";

const renderInline = (nodes: readonly Inline[]): ReactNode[] =>
  nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={index} className={styles.code}>
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children)}
          </a>
        );
    }
  });

const renderBlock = (block: Block, index: number): ReactElement => {
  switch (block.kind) {
    case "paragraph":
      return <p key={index}>{renderInline(block.children)}</p>;
    case "heading":
      return (
        <p key={index} className={styles.heading}>
          <strong>{renderInline(block.children)}</strong>
        </p>
      );
    case "code":
      return (
        <pre key={index} className={styles.pre}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={index} className={styles.quote}>
          {renderInline(block.children)}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
  }
};

/** Renders Claude's markdown (paragraphs, lists, code, bold, italics, links) as React elements without using innerHTML. */
export const Markdown = ({ text, className }: { readonly text: string; readonly className?: string }): ReactElement => (
  <div className={className ? `${styles.root} ${className}` : styles.root}>{parseMarkdown(text).map(renderBlock)}</div>
);

/** Renders a single line of inline markdown (code spans, bold, italics, links). */
export const InlineMarkdown = ({ text }: { readonly text: string }): ReactElement => <>{renderInline(parseInline(text))}</>;
