import React from 'react';

const ErrorOverlay = ({ message, onRetry }) => {
    if (!message) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl animate-in fade-in duration-500">
            <div className="w-full max-w-lg bg-white rounded-[2rem] p-10 shadow-2xl border border-white/20 flex flex-col items-center text-center transform transition-all duration-500 scale-100 opacity-100">
                {/* Icon */}
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-8">
                    <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                <h2 className="text-2xl font-bold text-slate-900 mb-4 tracking-tight">System Notification</h2>

                <p className="text-slate-600 mb-10 leading-relaxed font-medium">
                    {message}
                </p>

                <div className="flex gap-4 w-full justify-center">
                    <button
                        onClick={() => window.location.reload()}
                        className="flex-1 bg-red-600 text-white font-bold py-4 px-8 rounded-2xl hover:bg-red-700 transition-all shadow-lg hover:shadow-red-600/20 hover:-translate-y-1 active:translate-y-0"
                    >
                        Refresh Page
                    </button>
                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="flex-1 bg-slate-100 text-slate-700 font-bold py-4 px-8 rounded-2xl hover:bg-slate-200 transition-all hover:-translate-y-1 active:translate-y-0"
                        >
                            Dismiss
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ErrorOverlay;
