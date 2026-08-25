import { Box, Text } from "ink";
import Image from "ink-picture";
import { IMAGE_CELL_COLS, IMAGE_CELL_ROWS, imagePlaceholder, localImagePath } from "./images.js";
import type { TranscriptRow } from "./layout.js";

type Props = {
  row: TranscriptRow;
  inner: number;
};

/**
 * Kitty when the reserved block is fully on-screen (Ghostty). Half-block if
 * ink-picture reports the placement as partial. Never dumps APC from <Text>.
 */
export function Picture({ row, inner }: Props) {
  const src = row.image ? localImagePath(row.image) : undefined;
  const cols = Math.max(8, Math.min(IMAGE_CELL_COLS, inner));
  const alt = row.image?.alt?.trim() || "image";
  return (
    <Box
      width={inner}
      height={IMAGE_CELL_ROWS}
      justifyContent={row.align === "end" ? "flex-end" : "flex-start"}
      overflow="hidden"
    >
      {src ? (
        <Image
          src={src}
          width={cols}
          height={IMAGE_CELL_ROWS}
          alt={alt}
          objectFit="contain"
          protocol={{ full: "kitty" }}
        />
      ) : (
        <Text dimColor color="yellow" wrap="truncate">
          {row.text || imagePlaceholder(row.image ?? {})}
        </Text>
      )}
    </Box>
  );
}
