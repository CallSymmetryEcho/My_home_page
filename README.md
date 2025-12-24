# Bin Lian's Personal Homepage

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Version](https://img.shields.io/badge/Version-2.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)

Welcome to the source code for **Bin Lian's Personal Homepage**. This project is a modern, responsive academic portfolio designed to showcase research, education, and technical expertise.

## 🚀 Project Status
**Current Version: 2.0.0 (December 2025)**

The website has undergone a complete modernization overhaul, transitioning from a basic Bootstrap layout to a sophisticated, interactive single-page application (SPA) feel using vanilla JavaScript and advanced CSS3.

## ✨ New Features

### 1. Interactive Academic Timeline
*   **Vertical Layout:** A connected timeline displaying educational history.
*   **Glassmorphism Cards:** Frosted glass effect for a modern look.
*   **Floating 3D Logos:** University logos float and rotate on hover.
*   **Expandable Details:** Click to reveal coursework and achievements.

### 2. 3D Resume Preview
*   **Interactive Document:** A CSS-rendered 3D paper element that floats and tilts.
*   **Live PDF Embed:** Displays the actual resume file directly on the page.
*   **Reversible Animations:** Smoothly reveals and hides based on scroll direction.

### 3. Research Interest Grid
*   **Responsive Cards:** Auto-adjusting grid layout using CSS Grid.
*   **Dynamic Hover Effects:** Cards lift, glow, and reveal background decorations on interaction.
*   **Accessibility:** Reduced motion support and semantic markup.

### 4. Class Material Explorer
*   **3D Carousel:** An auto-rotating slider showcasing other web projects.
*   **Live Previews:** Embeds iframes of linked sites for instant context.

### 5. Mobile Optimization
*   **Responsive Layout:** Fixed alignment issues on mobile devices for the Certificates and Resume sections.
*   **Touch-Friendly Navigation:** Enhanced slider controls and buttons for better usability on small screens.
*   **Adaptive Typography:** Adjusted font sizes and spacing to ensure readability across all viewports.

## 🛠 Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/KIllerLB-USTC/My_home_page.git
    cd My_home_page
    ```

2.  **Open in Browser**
    Simply open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge). No build step or server is required for basic viewing.

3.  **Local Development (Optional)**
    For the best experience (to avoid CORS issues with iframes), serve the project locally:
    ```bash
    # Using Python 3
    python3 -m http.server 8000
    
    # Using Node.js http-server
    npx http-server .
    ```
    Access at `http://localhost:8000`.

## 📂 Project Structure

```
My_home_page/
├── index.html              # Main entry point
├── matrial.html            # Material library sub-page
├── bootstrap-4.4.1-dist/
│   ├── css/                # Framework styles
│   ├── js/                 # Framework scripts
│   └── others/
│       ├── style_c.css     # MAIN CUSTOM STYLESHEET
│       └── fixed.css       # Background/layout utilities
├── image/                  # Assets (logos, backgrounds, certificates)
├── UPDATE_LOG.md           # Detailed change history
└── TUTORIAL.md             # Technical implementation guide
```

## 🤝 Contribution Guidelines

We welcome contributions to improve the codebase!

1.  **Fork** the repository.
2.  **Create a Branch** (`git checkout -b feature/AmazingFeature`).
3.  **Commit** your changes (`git commit -m 'Add some AmazingFeature'`).
4.  **Push** to the branch (`git push origin feature/AmazingFeature`).
5.  **Open a Pull Request**.

Please ensure your code follows the existing style:
*   Use semantic HTML5.
*   Keep CSS in `style_c.css` and use CSS variables for colors.
*   Ensure all new animations respect `prefers-reduced-motion`.

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Maintained by Bin Lian.*
