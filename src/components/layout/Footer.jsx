import { FaGithub } from "react-icons/fa6";

function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line px-6 py-6 sm:px-10">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between">
        <span className="text-[12px] text-ink-faint">&copy; {year} Vecto. All rights reserved.</span>
        <a
          href="https://github.com/ashrafjr-n/vecto"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          className="text-ink-faint transition-colors hover:text-ink"
        >
          <FaGithub size={18} />
        </a>
      </div>
    </footer>
  );
}

export default Footer;
