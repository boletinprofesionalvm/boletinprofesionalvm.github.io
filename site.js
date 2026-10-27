(function () {
  "use strict";

  const editions = {
    septiembre: { title: "Septiembre", file: "boletin_septiembre.pdf" },
    agosto: { title: "Agosto", file: "boletin_agosto.pdf" },
    julio: { title: "Julio", file: "boletin_julio.pdf" },
    junio: { title: "Junio", file: "boletin_junio.pdf" },
    mayo: { title: "Mayo", file: "boletin_mayo.pdf" },
    abril: { title: "Abril", file: "boletin_abril.pdf" }
  };

  const bookElement = document.getElementById("book");
  const bookStage = document.getElementById("book-stage");
  const loadingElement = document.getElementById("book-loading");
  const errorElement = document.getElementById("reader-error");
  const pageCountElement = document.getElementById("page-count");
  const downloadLink = document.getElementById("pdf-download");
  const previousButton = document.getElementById("previous-page");
  const nextButton = document.getElementById("next-page");
  const editionTitle = document.getElementById("edition-title");
  const tabButtons = Array.from(document.querySelectorAll(".edition-tab"));

  let pageFlip;
  let pdfDocument;
  let renderedPages = new Map();
  let currentEdition = "septiembre";
  let loadToken = 0;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function setError(message) {
    loadingElement.hidden = true;
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  function createBookPages(pageTotal) {
    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= pageTotal; pageNumber += 1) {
      const page = document.createElement("div");
      page.className = "book-page";
      page.setAttribute("role", "img");
      page.setAttribute("aria-label", "Página " + pageNumber);
      page.dataset.pageNumber = String(pageNumber);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      page.append(canvas);
      fragment.append(page);
    }
    bookElement.replaceChildren(fragment);
  }

  async function renderPage(pageNumber, token) {
    if (token !== loadToken || !pdfDocument || pageNumber < 1 || pageNumber > pdfDocument.numPages || renderedPages.has(pageNumber)) return;
    const pageElement = bookElement.querySelector('[data-page-number="' + pageNumber + '"]');
    if (!pageElement) return;

    const pdfPage = await pdfDocument.getPage(pageNumber);
    if (token !== loadToken) return;
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(520 / baseViewport.width, 720 / baseViewport.height);
    const viewport = pdfPage.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 1.5) });
    const canvas = pageElement.querySelector("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const renderTask = pdfPage.render({ canvasContext: context, viewport: viewport, background: "#fffefa" });
    renderedPages.set(pageNumber, renderTask.promise);
    try {
      await renderTask.promise;
    } catch (error) {
      renderedPages.delete(pageNumber);
      if (token === loadToken) throw error;
    }
  }

  function renderNearCurrentPage() {
    if (!pageFlip || !pdfDocument) return;
    const firstPage = pageFlip.getCurrentPageIndex() + 1;
    const pageCount = pdfDocument.numPages;
    const pagesToRender = new Set([firstPage - 1, firstPage, firstPage + 1, firstPage + 2, firstPage + 3]);
    pagesToRender.forEach(function (pageNumber) {
      if (pageNumber >= 1 && pageNumber <= pageCount) {
        renderPage(pageNumber, loadToken).catch(function () {
          setError("No se pudo procesar una página de esta edición. Puedes abrir el PDF original desde el enlace de descarga.");
        });
      }
    });
  }

  function updateControls() {
    if (!pageFlip || !pdfDocument) return;
    const firstVisiblePage = pageFlip.getCurrentPageIndex() + 1;
    const isPortrait = pageFlip.getOrientation() === "portrait";
    const lastVisiblePage = Math.min(pdfDocument.numPages, firstVisiblePage + (isPortrait ? 0 : 1));
    pageCountElement.textContent = firstVisiblePage === lastVisiblePage
      ? "Página " + firstVisiblePage + " de " + pdfDocument.numPages
      : "Páginas " + firstVisiblePage + "–" + lastVisiblePage + " de " + pdfDocument.numPages;
    previousButton.disabled = firstVisiblePage <= 1;
    nextButton.disabled = lastVisiblePage >= pdfDocument.numPages;
  }

  async function loadEdition(editionKey) {
    const edition = editions[editionKey];
    if (!edition) return;
    currentEdition = editionKey;
    const token = ++loadToken;
    renderedPages = new Map();
    errorElement.hidden = true;
    loadingElement.hidden = false;
    loadingElement.textContent = "Preparando la edición…";
    bookElement.classList.remove("is-ready");
    pageCountElement.textContent = "Cargando edición…";
    editionTitle.textContent = edition.title;
    downloadLink.href = "./boletines/" + edition.file;
    downloadLink.setAttribute("download", edition.file);
    tabButtons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.edition === editionKey));
    });
    previousButton.disabled = true;
    nextButton.disabled = true;

    if (!window.pdfjsLib || !window.St || !window.St.PageFlip) {
      setError("No se pudo cargar el lector digital. Comprueba tu conexión a Internet y vuelve a intentar, o descarga el PDF original.");
      return;
    }

    try {
      if (pageFlip) {
        pageFlip.destroy();
        pageFlip = undefined;
      }
      if (pdfDocument) {
        await pdfDocument.destroy();
        pdfDocument = undefined;
      }
      if (token !== loadToken) return;
      if (!bookElement.isConnected) bookStage.append(bookElement);

      const task = window.pdfjsLib.getDocument({ url: "./boletines/" + edition.file, rangeChunkSize: 65536 });
      pdfDocument = await task.promise;
      if (token !== loadToken) return;

      createBookPages(pdfDocument.numPages);
      pageFlip = new window.St.PageFlip(bookElement, {
        width: 480,
        height: 650,
        size: "stretch",
        minWidth: 260,
        maxWidth: 500,
        minHeight: 400,
        maxHeight: 720,
        showCover: true,
        maxShadowOpacity: 0.28,
        flippingTime: 650,
        usePortrait: window.matchMedia("(max-width: 760px)").matches,
        mobileScrollSupport: false,
        drawShadow: true
      });
      pageFlip.loadFromHTML(bookElement.querySelectorAll(".book-page"));
      pageFlip.on("flip", function () {
        updateControls();
        renderNearCurrentPage();
      });
      pageFlip.on("changeOrientation", function () {
        updateControls();
        renderNearCurrentPage();
      });
      pageFlip.on("init", function () {
        bookElement.classList.add("is-ready");
        loadingElement.hidden = true;
        updateControls();
        renderNearCurrentPage();
      });
      requestAnimationFrame(function () {
        if (token !== loadToken) return;
        bookElement.classList.add("is-ready");
        loadingElement.hidden = true;
        updateControls();
        renderNearCurrentPage();
      });
    } catch (error) {
      if (token === loadToken) {
        setError("No se pudo abrir esta edición. Puedes descargar el PDF original e intentarlo de nuevo.");
        console.error("Error al cargar la edición", error);
      }
    }
  }

  tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.edition !== currentEdition) loadEdition(button.dataset.edition);
    });
  });
  previousButton.addEventListener("click", function () {
    if (pageFlip) pageFlip.flipPrev();
  });
  nextButton.addEventListener("click", function () {
    if (pageFlip) pageFlip.flipNext();
  });

  loadEdition(currentEdition);
})();