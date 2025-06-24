export interface VentuzStreamPlayerAttributes {
  url?: string;
  extralatency?: number;
  usekeyboard?: boolean;
  usemouse?: boolean;
  usetouch?: boolean;
  fullscreenbutton?: boolean;
  retryinterval?: number;
}

export interface VentuzStreamPlayerElement extends HTMLElement, VentuzStreamPlayerAttributes {}

declare global {
  interface HTMLElementTagNameMap {
    "ventuz-stream-player": VentuzStreamPlayerElement;
  }
}

declare module "react" {
   namespace JSX {
      interface IntrinsicElements {
          "ventuz-stream-player": VentuzStreamPlayerAttributes & React.ClassAttributes<VentuzStreamPlayerElement>;
      }
    }
}

declare module "ventuz-stream-player" {
	export {};
}
