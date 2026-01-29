import React from 'react';
import { Link } from 'react-router-dom';
import craneVisual from '../assets/Crane Main Page.png';

function Home() {
    return (
        <div className="min-h-screen w-full bg-[#f8f9fa] font-sans flex flex-col overflow-hidden text-slate-800">
            {/* Navbar - Minimalist & Clean */}
            <nav className="w-full py-6 px-8 md:px-16 flex justify-between items-center z-50 bg-[#f8f9fa]">
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 bg-red-600 rounded-full"></div>
                    <span className="font-medium text-lg tracking-wider text-black">YAXHA</span>
                </div>
                <div className="hidden md:flex gap-10 text-slate-500 text-sm font-medium tracking-wide">
                    <a href="#" className="hover:text-black transition-colors duration-300">About</a>
                    <a href="#" className="hover:text-black transition-colors duration-300">Benchmarks</a>
                    <a href="#" className="hover:text-black transition-colors duration-300">Contact</a>
                </div>
            </nav>

            {/* Main Content */}
            <div className="flex-1 w-full relative flex flex-col justify-center items-center">

                {/* Visual Element - Left Side Illustration */}
                <div className="absolute top-1/2 -translate-y-1/2 left-4 md:left-16 z-0 opacity-90 pointer-events-none hidden lg:block">
                    <img
                        src={craneVisual}
                        alt="Study Illustration"
                        className="w-80 xl:w-96 object-contain opacity-90 mix-blend-multiply"
                    />
                </div>

                {/* Hero Text - Centered & Clean */}
                <main className="relative z-10 flex flex-col items-center text-center px-6 max-w-3xl mx-auto -mt-10">
                    <h1 className="text-5xl md:text-7xl font-bold mb-8 text-slate-900 tracking-tight leading-[1.1]">
                        Master Your <br />
                        <span className="text-red-600">IELTS Speaking</span>
                    </h1>
                    <p className="text-lg md:text-xl text-slate-500 mb-10 font-normal max-w-xl leading-relaxed">
                        A personal AI evaluator designed to listen, analyze, and grade your speaking skills against official benchmarks.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-5 w-full justify-center">
                        <Link to="/evaluate" className="bg-red-600 text-white px-8 py-3.5 rounded-full text-base font-medium hover:bg-red-700 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 text-center">
                            Start Evaluation
                        </Link>
                        <button className="bg-white text-slate-700 px-8 py-3.5 rounded-full text-base font-medium border border-slate-200 hover:border-slate-400 hover:text-black transition-all shadow-sm hover:shadow text-center">
                            Learn More
                        </button>
                    </div>
                </main>

                <footer className="absolute bottom-8 w-full text-center z-20">
                    <p className="text-slate-400 text-[10px] tracking-[0.2em] uppercase font-medium">Inspired by the elegance of the Sarus Crane</p>
                </footer>
            </div>
        </div>
    );
}

export default Home;
