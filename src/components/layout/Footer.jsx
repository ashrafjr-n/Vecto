import { Link } from "react-router-dom";
import { FaGithub } from "react-icons/fa6";

const LINKS = [
  { to: "/about",       label: "About" },
  { to: "/methodology", label: "Methodology" },
  { to: "/privacy",     label: "Privacy" },
  { to: "/terms",       label: "Terms" },
];

function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line px-6 py-8 sm:px-10">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12.5px] text-ink-faint">&copy; {year} Vecto</span>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => window.scrollTo(0, 0)}
              className="text-[12.5px] text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/ashrafjr-n/vecto"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="text-ink-faint transition-colors hover:text-ink"
          >
            <FaGithub size={17} />
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;
