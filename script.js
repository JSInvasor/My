// Small parallax for the hero window on mouse move
(function () {
  const win = document.querySelector(".hero-visual .window");
  if (!win) return;

  const hero = document.querySelector(".hero");
  let raf = 0;

  hero.addEventListener("mousemove", (e) => {
    const rect = hero.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      win.style.transform = `rotateX(${4 - y * 3}deg) rotateY(${x * 3}deg)`;
    });
  });

  hero.addEventListener("mouseleave", () => {
    win.style.transform = "rotateX(4deg) rotateY(0deg)";
  });
})();

// Reveal-on-scroll
(function () {
  const els = document.querySelectorAll(
    ".feature-card, .section-title, .section-sub, .metric, .cta-box, .showcase-copy, .showcase-visual"
  );
  if (!("IntersectionObserver" in window) || !els.length) return;

  els.forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(16px)";
    el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  els.forEach((el) => io.observe(el));
})();

// Terminal typing loop
(function () {
  const caret = document.querySelector(".terminal .caret");
  if (!caret) return;

  const phrases = [
    "agent plan --task 'migrate to JWT-less auth'",
    "agent run --parallel 4",
    "agent verify --browser chromium",
    "agent merge refactor-auth → main",
  ];
  const host = caret.parentElement;
  let i = 0;

  function typeNext() {
    const text = phrases[i % phrases.length];
    host.innerHTML = '<span class="prompt">$</span> ';
    let j = 0;
    const typed = document.createElement("span");
    host.appendChild(typed);
    const caretEl = document.createElement("span");
    caretEl.className = "caret";
    host.appendChild(caretEl);

    const tick = setInterval(() => {
      typed.textContent = text.slice(0, j++);
      if (j > text.length) {
        clearInterval(tick);
        setTimeout(() => {
          i++;
          typeNext();
        }, 1800);
      }
    }, 45);
  }

  typeNext();
})();
