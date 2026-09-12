/**
 * Real KookieUI v2 controls in `material="regular"`, drawn by the browser, for the GL controls to
 * be compared against pixel for pixel. Not a law and not shipped: the ground truth a look spike
 * screenshots beside the canvas.
 */

import { createRoot } from 'react-dom/client';
import {
  Theme,
  Box,
  Button,
  TextField,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  Slider,
  Checkbox,
} from '@kookie-ui/react';

const q = new URLSearchParams(location.search);
const appearance = (q.get('appearance') ?? 'light') as 'light' | 'dark';
const open = q.get('open') === '1';

function App() {
  return (
    <Theme appearance={appearance} material="regular" radius="full">
      <Box backdrop>
        <div
          id="stage"
          style={{
            padding: 24,
            width: 420,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            background: 'var(--color-background, var(--neutral-1))',
          }}
        >
          <div id="toolbar" style={{ display: 'flex', gap: 8 }}>
            <Button backdrop emphasis="quiet">Back</Button>
            <Button backdrop>Default</Button>
            <Button backdrop emphasis="loud">Loud</Button>
          </div>
          <div id="field" style={{ width: 220 }}>
            <TextField backdrop defaultValue="name" />
          </div>
          <div id="select" style={{ width: 220 }}>
            <Select defaultValue="one" open={open} items={{ one: 'one', two: 'two', three: 'three' }}>
              <SelectTrigger backdrop style={{ width: '100%' }} />
              <SelectContent>
                <SelectItem value="one">one</SelectItem>
                <SelectItem value="two">two</SelectItem>
                <SelectItem value="three">three</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div id="slider" style={{ width: 220 }}>
            <Slider defaultValue={0.39} min={0} max={1} step={0.01} aria-label="Amount" />
          </div>
          <div id="checks" style={{ display: 'flex', gap: 12 }}>
            <Checkbox aria-label="off" />
            <Checkbox aria-label="on" defaultChecked />
          </div>
        </div>
      </Box>
    </Theme>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
