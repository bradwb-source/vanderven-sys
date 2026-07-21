(() => {
  const form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      form.classList.add("is-sent");
    });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    document.querySelectorAll("video[autoplay]").forEach((video) => {
      video.pause();
      video.removeAttribute("autoplay");
    });
  } else {
    document.querySelectorAll(".hero__media video").forEach((video) => {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = true;
      video.autoplay = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("loop", "");
      video.setAttribute("autoplay", "");

      const start = () => {
        if (document.hidden) return;
        const attempt = video.play();
        if (attempt && typeof attempt.catch === "function") {
          attempt.catch(() => {});
        }
      };

      if (video.readyState >= 2) start();
      else {
        video.addEventListener("loadeddata", start, { once: true });
        video.addEventListener("canplay", start, { once: true });
      }

      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) start();
      });
    });

    document.querySelectorAll(".video-band video").forEach((video) => {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = true;
      const slow =
        !video.closest(".video-band--okanagan") &&
        !video.classList.contains("video-band__native");
      const applyRate = () => {
        video.playbackRate = slow ? 0.5 : 1;
      };
      applyRate();
      video.addEventListener("play", applyRate);
      video.addEventListener("loadeddata", applyRate);
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => {});
      }
    });
  }

  const items = [...document.querySelectorAll(".reveal")];
  if (!items.length) return;

  const show = (el) => el.classList.add("is-in");

  if (reduceMotion) {
    items.forEach(show);
    return;
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 0.9 && r.bottom > 0;
  };

  const rest = items.filter((el) => {
    if (visible(el)) {
      show(el);
      return false;
    }
    return true;
  });

  if (!rest.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          show(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 }
  );

  rest.forEach((el) => observer.observe(el));
})();
