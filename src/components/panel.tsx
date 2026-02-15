import React from "react";
import { Box, Text } from "ink";
import { C, theme } from "../theme.js";

export function Panel({
  title,
  hotkey,
  focused,
  children,
  width,
  height,
  flexGrow,
}: {
  title: string;
  hotkey?: string;
  focused?: boolean;
  children: React.ReactNode;
  width?: number | string;
  height?: number;
  flexGrow?: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle={theme.border}
      borderColor={focused ? C.primary : C.dim}
      width={width}
      height={height}
      flexGrow={flexGrow}
      flexShrink={width ? 0 : undefined}
      padding={1}
      overflowX="hidden"
    >
      <Text>
        {hotkey && (
          <Text color={focused ? C.primary : C.dim}>[{hotkey}]</Text>
        )}
        <Text color={focused ? C.primary : C.subtext} bold={focused}>
          {hotkey ? " " : ""}{title}
        </Text>
      </Text>
      {children}
    </Box>
  );
}
