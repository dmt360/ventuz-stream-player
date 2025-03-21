class HelloWorld extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          p {
            color: blue;
            font-family: Arial, sans-serif;
          }
        </style>
        <p>Hello, World!</p>
      `;
    }
  }
  
  customElements.define('hello-world', HelloWorld);