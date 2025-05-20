/**
 * Ventuz Stream Player
 * A web component for playing back Ventuz Stream Out outputs in the browser,
 * with keyboard, mouse, and touch input support.
 * Copyright (c) 2025 Ventuz Technology, all rights reserved.
 */

// Yes, this is AI generated. No, I didn't test every single key.

// Mapping of JavaScript key codes to Windows Virtual Key (VKEY) codes
const codeToVKeyMap : { [code: string] : number }= {
  'Backspace': 0x08,      // VK_BACK
  'Tab': 0x09,            // VK_TAB
  'Enter': 0x0D,          // VK_RETURN
  'ShiftLeft': 0xA0,      // VK_LSHIFT
  'ShiftRight': 0xA1,     // VK_RSHIFT
  'ControlLeft': 0xA2,    // VK_LCONTROL
  'ControlRight': 0xA3,   // VK_RCONTROL
  'AltLeft': 0xA4,        // VK_LMENU
  'AltRight': 0xA5,       // VK_RMENU
  'Pause': 0x13,          // VK_PAUSE
  'CapsLock': 0x14,       // VK_CAPITAL
  'Escape': 0x1B,         // VK_ESCAPE
  'Space': 0x20,          // VK_SPACE
  'PageUp': 0x21,         // VK_PRIOR
  'PageDown': 0x22,       // VK_NEXT
  'End': 0x23,            // VK_END
  'Home': 0x24,           // VK_HOME
  'ArrowLeft': 0x25,      // VK_LEFT
  'ArrowUp': 0x26,        // VK_UP
  'ArrowRight': 0x27,     // VK_RIGHT
  'ArrowDown': 0x28,      // VK_DOWN
  'PrintScreen': 0x2C,    // VK_SNAPSHOT
  'Insert': 0x2D,         // VK_INSERT
  'Delete': 0x2E,         // VK_DELETE
  // Alphanumeric keys
  'Digit0': 0x30, 'Digit1': 0x31, 'Digit2': 0x32, 'Digit3': 0x33, 'Digit4': 0x34,
  'Digit5': 0x35, 'Digit6': 0x36, 'Digit7': 0x37, 'Digit8': 0x38, 'Digit9': 0x39,
  'KeyA': 0x41, 'KeyB': 0x42, 'KeyC': 0x43, 'KeyD': 0x44, 'KeyE': 0x45,
  'KeyF': 0x46, 'KeyG': 0x47, 'KeyH': 0x48, 'KeyI': 0x49, 'KeyJ': 0x4A,
  'KeyK': 0x4B, 'KeyL': 0x4C, 'KeyM': 0x4D, 'KeyN': 0x4E, 'KeyO': 0x4F,
  'KeyP': 0x50, 'KeyQ': 0x51, 'KeyR': 0x52, 'KeyS': 0x53, 'KeyT': 0x54,
  'KeyU': 0x55, 'KeyV': 0x56, 'KeyW': 0x57, 'KeyX': 0x58, 'KeyY': 0x59,
  'KeyZ': 0x5A,
  // Function keys
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74,
  'F6': 0x75, 'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79,
  'F11': 0x7A, 'F12': 0x7B,
  // Numpad keys
  'Numpad0': 0x60, 'Numpad1': 0x61, 'Numpad2': 0x62, 'Numpad3': 0x63,
  'Numpad4': 0x64, 'Numpad5': 0x65, 'Numpad6': 0x66, 'Numpad7': 0x67,
  'Numpad8': 0x68, 'Numpad9': 0x69,
  'NumpadMultiply': 0x6A, // VK_MULTIPLY
  'NumpadAdd': 0x6B,      // VK_ADD
  'NumpadSubtract': 0x6D, // VK_SUBTRACT
  'NumpadDecimal': 0x6E,  // VK_DECIMAL
  'NumpadDivide': 0x6F,   // VK_DIVIDE
  // Special keys (US QWERTY layout)
  'Semicolon': 0xBA,      // VK_OEM_1
  'Equal': 0xBB,          // VK_OEM_PLUS
  'Comma': 0xBC,          // VK_OEM_COMMA
  'Minus': 0xBD,          // VK_OEM_MINUS
  'Period': 0xBE,         // VK_OEM_PERIOD
  'Slash': 0xBF,          // VK_OEM_2
  'Backquote': 0xC0,      // VK_OEM_3
  'BracketLeft': 0xDB,    // VK_OEM_4
  'Backslash': 0xDC,      // VK_OEM_5
  'BracketRight': 0xDD,   // VK_OEM_6
  'Quote': 0xDE           // VK_OEM_7
};

// Function to convert keydown/keyup event to VKEY code
export function keyEventToVKey(event: KeyboardEvent) {
  // Return the VKEY code or null if not found
  return codeToVKeyMap[event.code] || null;
}
