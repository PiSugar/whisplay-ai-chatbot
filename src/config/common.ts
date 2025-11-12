import { ToolReturnTag } from "../type";

export const extractToolResponse = (content: string): string => {
  if (content.startsWith(ToolReturnTag.Response)) {
    return content.slice(ToolReturnTag.Response.length).trim();
  }
  return content;
};

export const stimulateStreamResponse = async ({
  content,
  partialCallback,
  endResolve,
  endCallback,
}: {
  content: string;
  partialCallback: (chunk: string) => void;
  endResolve: () => void;
  endCallback: () => void;
}) => {
  const words = content.split(" ");
  let index = 0;
  while (index < words.length) {
    const chunk = words.slice(index, index + 5).join(" ");
    partialCallback(chunk);
    index += 5;
    await new Promise((res) => setTimeout(res, 1000));
  }
  partialCallback(content);
  endResolve();
  endCallback();
};
