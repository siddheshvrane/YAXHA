import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Evaluation from './pages/Evaluation';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/evaluate" element={<Evaluation />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
