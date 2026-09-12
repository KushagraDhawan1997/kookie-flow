"use client";

/**
 * The Theme's own prop configurator, in the sidebar's footer beside the appearance toggle
 * (2026-09-08, Kushagra). This moves the whole site, which is the one way to judge an axis where it is actually read — a compact
 * density on the nav rows, a squared radius on every card, a coarse pointer on the buttons you
 * are pressing.
 *
 * Appearance is NOT here: the toggle beside it already owns that choice, and two controls for
 * one fact is the entropy this site keeps deleting. Contrast is, because nothing else offers it.
 */
import * as React from "react";
import {
  Button,
  Grid,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  SegmentedItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Text,
  ToolbarButton,
  themeAxes,
} from "@kookie-ui/react";

import { setContrast, useAppearance, type ContrastChoice } from "./appearance";
import { SettingsIcon } from "./icons";
import { THEME_AXES, resetTheme, setThemeAxis, useThemeChoice, type ThemeAxisKey } from "./theme-store";

/** The panel's index: a small form, one step under the frame's chrome. */
const PANEL_SIZE = "2" as const;

const CONTRASTS: readonly ContrastChoice[] = ["auto", "normal", "high"];

const LABEL: Record<ThemeAxisKey | "contrast", string> = {
  size: "Size",
  density: "Density",
  radius: "Radius",
  depth: "Depth",
  material: "Material",
  pointer: "Pointer",
  contrast: "Contrast",
};

/** Digits lay out flat; words go behind a trigger. */
const laidOut = (values: readonly string[]) => values.every((v) => v.length <= 2);

function Row({
  name,
  values,
  value,
  onChange,
}: {
  name: string;
  values: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `theme-label-${name}`;
  return (
    <>
      <Text size={PANEL_SIZE} emphasis="medium" id={id} style={{ justifySelf: "start" }}>
        {LABEL[name as ThemeAxisKey | "contrast"]}
      </Text>
      {laidOut(values) ? (
        <SegmentedControl size={PANEL_SIZE} aria-labelledby={id} value={value} onValueChange={(next) => onChange(String(next))}>
          {values.map((v) => (
            <SegmentedItem key={v} value={v}>
              {v}
            </SegmentedItem>
          ))}
        </SegmentedControl>
      ) : (
        <Select size={PANEL_SIZE} value={value} onValueChange={(next) => onChange(String(next))} items={Object.fromEntries(values.map((v) => [v, v]))}>
          <SelectTrigger aria-labelledby={id} />
          <SelectContent>
            {values.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}

export function ThemePanel() {
  const choice = useThemeChoice();
  const { contrast } = useAppearance();
  return (
    <Popover size={PANEL_SIZE}>
      <PopoverTrigger
        render={
          <ToolbarButton iconOnly backdrop aria-label="Theme">
            <SettingsIcon />
          </ToolbarButton>
        }
      />
      <PopoverContent aria-label="Theme">
        <Grid
          columns="auto max-content"
          gapX="4"
          gapY="3"
          align="center"
          style={{ gridAutoRows: `var(--control-height-${PANEL_SIZE})`, justifyItems: "end" }}
        >
          {THEME_AXES.map((key) => (
            <Row
              key={key}
              name={key}
              values={themeAxes[key] as readonly string[]}
              value={choice[key]}
              onChange={(next) => setThemeAxis(key, next as never)}
            />
          ))}
          <Row name="contrast" values={CONTRASTS} value={contrast} onChange={(next) => setContrast(next as ContrastChoice)} />
          <span />
          <Button size={PANEL_SIZE} emphasis="quiet" onClick={resetTheme}>
            Reset
          </Button>
        </Grid>
      </PopoverContent>
    </Popover>
  );
}
