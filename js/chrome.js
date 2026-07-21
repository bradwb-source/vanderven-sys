(() => {
  const page = document.body.dataset.page || "home";
  const solid = page !== "home";

  const links = [
    { href: "real-estate.html", id: "real-estate", label: "Real estate" },
    { href: "property.html", id: "property", label: "Property" },
    { href: "professional.html", id: "professional", label: "Professional" },
    { href: "trades.html", id: "trades", label: "Trades" },
    { href: "services.html", id: "services", label: "Services" },
    { href: "about.html", id: "about", label: "About" },
    { href: "contact.html", id: "contact", label: "Contact", cta: true },
  ];

  const nav = links
    .map((link) => {
      const active = page === link.id ? ' aria-current="page"' : "";
      const aCls = link.cta ? ' class="nav-cta"' : "";
      return `<li><a href="${link.href}"${aCls}${active}>${link.label}</a></li>`;
    })
    .join("");

  const header = document.getElementById("site-header");
  if (header) {
    header.outerHTML = `
<header class="site-header${solid ? " site-header--solid" : ""}">
  <div class="container site-header__inner">
    <a class="nav-logo" href="index.html" aria-label="Vanderven Systems home">
      <img class="nav-logo__mark" src="public/logo-mark-nav.png" alt="" width="123" height="74" />
      <span class="nav-logo__word">
        <strong>Vanderven</strong>
        <span>Systems</span>
      </span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav">
      <span class="nav-toggle__bar"></span>
      <span class="nav-toggle__bar"></span>
      <span class="sr-only">Menu</span>
    </button>
    <nav id="primary-nav" aria-label="Primary">
      <ul class="nav-links">${nav}</ul>
    </nav>
  </div>
</header>`;
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.outerHTML = `
<footer class="site-footer">
  <div class="container site-footer__inner">
    <div class="site-footer__brand">
      <a class="site-footer__logo" href="index.html" aria-label="Vanderven Systems home">
        <img src="public/logo-mark-nav.png" alt="" width="123" height="74" />
        <span>
          <strong>Vanderven</strong>
          <em>Systems</em>
        </span>
      </a>
      <p>Websites, automation &amp; marketing for real estate, property management, professional services &amp; trades across the Okanagan.</p>
    </div>
    <div class="site-footer__cols">
      <nav class="site-footer__nav" aria-label="Industries">
        <p class="site-footer__label">Industries</p>
        <a href="real-estate.html">Real estate</a>
        <a href="property.html">Property management</a>
        <a href="professional.html">Professional services</a>
        <a href="trades.html">Trades &amp; home services</a>
      </nav>
      <div class="site-footer__nav">
        <p class="site-footer__label">Reach us</p>
        <a href="mailto:hello@vandervensystems.com">hello@vandervensystems.com</a>
        <span>Okanagan, British Columbia</span>
        <span>By appointment</span>
      </div>
    </div>
  </div>
  <div class="container site-footer__bar">
    <p>© ${new Date().getFullYear()} Vanderven Systems</p>
    <p>Serving the Okanagan</p>
  </div>
</footer>`;
  }

  const siteHeader = document.querySelector(".site-header");
  const onScroll = () => {
    if (!siteHeader || solid) return;
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const toggle = document.querySelector(".nav-toggle");
  const primaryNav = document.getElementById("primary-nav");
  if (toggle && primaryNav) {
    toggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    primaryNav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        document.body.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }
})();
