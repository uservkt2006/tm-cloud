import React, { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// ErrorBoundary inline để bắt React error full stack
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('REACT_ERROR:', error, info); }
  render() {
    if (this.state.error) {
      return createElement('div', {
        style: {position:'fixed', inset:0, background:'#1a0d0d', color:'#ffcccc', padding:24, overflow:'auto', fontFamily:'monospace', fontSize:12, zIndex:99999}
      },
        createElement('h2', {style:{color:'#ff6666'}}, 'React error: ' + this.state.error.message),
        createElement('pre', null, this.state.error.stack || ''),
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  createElement(Boundary, null, createElement(App))
);
