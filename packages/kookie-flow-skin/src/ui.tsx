import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SegmentedControl,
  SegmentedItem,
  TextField,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  iconStroke,
} from '@kushagradhawan/kookie-ui-react';
import type { SkinUI } from '@kushagradhawan/kookie-flow-webgl/internal/skin/types';

/**
 * KookieUI v2's controls, with `backdrop` on everything that sits over the canvas.
 *
 * NO CARD behind the toolbar. Every control is glass, and glass holds on any ground — so the
 * canvas is the toolbar's background, and each control or group draws its own capsule, as a v2
 * toolbar does. `backdrop` tells every glass-capable control in the row that the canvas passes
 * behind it, once on the toolbar, and again on groups and fields that stand alone.
 */
export const ui: SkinUI = {
  Toolbar: (props) => <Toolbar backdrop {...props} />,
  ToolbarGroup: (props) => <ToolbarGroup backdrop {...props} />,
  ToolbarButton,
  Button: (props) => <Button backdrop {...props} />,
  TextField: (props) => <TextField backdrop {...props} />,
  Select,
  SelectTrigger: (props) => <SelectTrigger backdrop {...props} />,
  SelectContent,
  SelectItem,
  SegmentedControl: (props) => <SegmentedControl backdrop {...props} />,
  SegmentedItem,
  iconStroke,
};
