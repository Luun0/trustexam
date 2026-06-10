import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Global reset
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.boxSizing = 'border-box';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
