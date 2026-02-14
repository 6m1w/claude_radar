import React from "react";
import { Text } from "ink";
import { C, theme } from "../theme.js";

export function Progress({
  done,
  total,
  width = 16,
}: {
  done: number;
  total: number;
  width?: number;
}) {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  return (
    <Text>
      <Text color={C.success}>{theme.progress.filled.repeat(filled)}</Text>
      <Text color={C.dim}>{theme.progress.empty.repeat(width - filled)}</Text>
      <Text color={C.subtext}> {done}/{total}</Text>
    </Text>
  );
}
