import { useNavigate } from "react-router-dom";

function Home() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Poppins:wght@300;400;500;600&display=swap');

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .home-container {
          position: relative;
          height: 100vh;
          width: 100%;
          overflow: hidden;
          font-family: 'Poppins', sans-serif;
          color: #ffffff;
        }

        .hero-bg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          /* Using a higher quality Unsplash food image for a cleaner look */
          background-image: url('https://images.unsplash.com/photo-1512058564366-18510be2db19?q=80&w=2070&auto=format&fit=crop'); 
          background-size: cover;
          background-position: center;
          /* Subtle zoom animation for life without being distracting */
          animation: slowZoom 20s infinite alternate;
          z-index: -1;
        }

        .overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          /* Richer, deeper gradient for professional "restaurant" vibe */
          background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%);
          z-index: 0;
        }

        .hero-content {
          position: relative;
          z-index: 10;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          padding: 0 20px;
          /* Staggered animation entry */
          animation: fadeIn 1s ease-out;
        }

        /* Tagline styling with decorative line */
        .tagline-wrapper {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 2rem;
          opacity: 0;
          animation: slideDown 0.8s ease-out 0.2s forwards;
        }

        .decorative-line {
          width: 60px;
          height: 1px;
          background-color: rgba(255, 215, 0, 0.6);
        }

        .tagline {
          color: #FFD700;
          text-transform: uppercase;
          letter-spacing: 4px;
          font-size: 0.8rem;
          font-weight: 500;
        }

        h1 {
          font-family: 'Playfair Display', serif;
          font-size: clamp(3.5rem, 8vw, 6rem); /* Responsive font size */
          line-height: 1;
          margin-bottom: 1rem;
          text-shadow: 0 10px 30px rgba(0,0,0,0.5);
          font-weight: 700;
          letter-spacing: -1px;
          opacity: 0;
          animation: slideUp 0.8s ease-out 0.4s forwards;
        }

        h2 {
          font-family: 'Poppins', sans-serif;
          font-size: 1.5rem;
          font-weight: 300;
          margin-bottom: 3rem;
          opacity: 0;
          letter-spacing: 2px;
          color: rgba(255, 255, 255, 0.9);
          animation: fadeIn 1s ease-out 0.6s forwards;
        }
        
        h2 span {
            font-weight: 500;
            color: #FFD700;
            font-style: italic;
        }

        /* Professional Glassmorphism Info Bar */
        .info-bar {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0; /* Handled by padding in items */
          margin-bottom: 3.5rem;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 16px 32px;
          border-radius: 100px; /* Pill shape */
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
          opacity: 0;
          transform: translateY(10px);
          animation: fadeUp 0.8s ease-out 0.8s forwards;
        }

        .info-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 24px;
          font-size: 0.95rem;
          font-weight: 500;
          color: #fff;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        /* Remove border for last item */
        .info-item:not(:last-child) {
            border-right: 1px solid rgba(255, 255, 255, 0.2);
        }

        .info-icon {
            font-size: 1.1rem;
            color: #FFD700;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
        }
        
        /* Hide separators from original code, replace with borders */
        .info-separator {
          display: none; 
        }

        /* Upgraded CTA Button */
        .cta-btn {
          background-color: #FFD700;
          color: #1a1a1a;
          border: none;
          padding: 18px 56px;
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: 2px;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          text-transform: uppercase;
          border-radius: 50px; /* Pill shape button */
          box-shadow: 0 10px 30px rgba(255, 215, 0, 0.3);
          position: relative;
          overflow: hidden;
          opacity: 0;
          animation: scaleIn 0.6s ease-out 1s forwards;
        }

        /* Shine effect on button */
        .cta-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
            transition: 0.5s;
        }

        .cta-btn:hover {
          background-color: #ffdf33;
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 15px 40px rgba(255, 215, 0, 0.4);
        }
        
        .cta-btn:hover::before {
            left: 100%;
        }

        .footer-info {
          position: absolute;
          bottom: 30px;
          width: 100%;
          text-align: center;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.6);
          letter-spacing: 0.5px;
          z-index: 10;
          opacity: 0;
          animation: fadeIn 1s ease-out 1.2s forwards;
        }
        
        .footer-info::before {
            content: '•';
            margin: 0 8px;
            color: #FFD700;
        }
        .footer-info::after {
            content: '•';
            margin: 0 8px;
            color: #FFD700;
        }

        /* --- Animations --- */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }

        @keyframes slowZoom {
            from { transform: scale(1); }
            to { transform: scale(1.1); }
        }

        /* --- Responsive Improvements --- */
        @media (max-width: 768px) {
          .tagline-wrapper {
            gap: 0.5rem;
          }
          .decorative-line {
            width: 30px;
          }
          h1 { 
            font-size: 3.2rem; 
            margin-bottom: 0.5rem;
          }
          h2 { 
            font-size: 1.1rem; 
            margin-bottom: 2.5rem;
            letter-spacing: 1px;
          }
          .info-bar { 
            flex-direction: column; 
            gap: 12px;
            border-radius: 20px;
            padding: 20px;
            width: 90%;
          }
          .info-item {
             font-size: 0.9rem;
             padding: 0;
             border-right: none !important; /* Force remove border on mobile */
          }
          .info-item:not(:last-child) {
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              padding-bottom: 12px;
              width: 100%;
              justify-content: center;
          }
          
          .cta-btn { 
            padding: 16px 40px; 
            font-size: 0.95rem;
            width: 90%;
          }
        }
      `}</style>

      <div className="home-container">
        <div className="hero-bg"></div>
        <div className="overlay"></div>

        <div className="hero-content">
          
          <div className="tagline-wrapper">
            <div className="decorative-line"></div>
            <span className="tagline">Authentic Vegetarian Cuisine</span>
            <div className="decorative-line"></div>
          </div>
          
          <h1>50-50' Chinese Fast Food</h1>
          <h2><span>Delicious</span> <span>• Fresh •</span><span>Affordable</span></h2>

          <div className="info-bar">
            <div className="info-item">
              <span className="info-icon">★</span>
              <span>4.2 Rating</span>
            </div>
            <div className="info-item">
              <span className="info-icon">📍</span>
              <span>Chhatrapati Sambhajinagar</span>
            </div>
            <div className="info-item">
              <span className="info-icon">🕐</span>
              <span>Open 1:00 PM - 11:30 PM</span>
            </div>
          </div>

          <button 
            onClick={() => navigate("/tables")} 
            className="cta-btn"
          >
            Start Order
          </button>
        </div>

        <div className="footer-info">
           D-1, Kalamahak HSG Society, Zone B, CIDCO
        </div>
      </div>
    </>
  );
}
  
export default Home;