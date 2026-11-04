(function () {
  "use strict";

  const editions = {
    octubre: { title: "Octubre", file: "boletin_octubre.pdf" },
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
  let failedPages = new Set();
  let currentEdition = "octubre";
  let loadToken = 0;
  const renderErrorMessage = "No se pudo procesar una página de esta edición. Puedes abrir el PDF original desde el enlace de descarga.";

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
      page.setAttribute("role", "group");
      page.setAttribute("aria-label", "Página " + pageNumber);
      page.dataset.pageNumber = String(pageNumber);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      page.append(canvas);
      fragment.append(page);
    }
    bookElement.replaceChildren(fragment);
  }

  function renderPage(pageNumber, token) {
    if (token !== loadToken || !pdfDocument || pageNumber < 1 || pageNumber > pdfDocument.numPages) return Promise.resolve();
    if (renderedPages.has(pageNumber)) return renderedPages.get(pageNumber);
    const pageElement = bookElement.querySelector('[data-page-number="' + pageNumber + '"]');
    if (!pageElement) return Promise.resolve();
    const pdfDocumentSnapshot = pdfDocument;

    const renderPromise = (async function () {
      const pdfPage = await pdfDocumentSnapshot.getPage(pageNumber);
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
      await renderTask.promise;
      if (token !== loadToken) return;

      const annotations = await pdfPage.getAnnotations();
      const linkLayer = document.createElement("div");
      linkLayer.className = "page-link-layer";
      linkLayer.setAttribute("aria-label", "Enlaces de la página " + pageNumber);
      const linkFragment = document.createDocumentFragment();

      for (const annotation of annotations) {
        if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) continue;
        const bounds = viewport.convertToViewportRectangle(annotation.rect);
        const left = Math.max(0, Math.min(bounds[0], bounds[2]));
        const top = Math.max(0, Math.min(bounds[1], bounds[3]));
        const right = Math.min(viewport.width, Math.max(bounds[0], bounds[2]));
        const bottom = Math.min(viewport.height, Math.max(bounds[1], bounds[3]));
        if (right <= left || bottom <= top) continue;

        let href;
        let targetPage;
        if (annotation.url) {
          const url = new URL(annotation.url, window.location.href);
          if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) continue;
          href = url.href;
        } else if (annotation.dest) {
          const destination = typeof annotation.dest === "string"
            ? await pdfDocumentSnapshot.getDestination(annotation.dest)
            : annotation.dest;
          if (token !== loadToken || !Array.isArray(destination) || destination.length === 0) continue;
          const destinationPage = destination[0];
          const pageIndex = Number.isInteger(destinationPage)
            ? destinationPage
            : await pdfDocumentSnapshot.getPageIndex(destinationPage);
          if (pageIndex < 0 || pageIndex >= pdfDocumentSnapshot.numPages) continue;
          targetPage = pageIndex + 1;
          href = "#page-" + targetPage;
        } else {
          continue;
        }

        const link = document.createElement("a");
        link.className = "page-link";
        link.href = href;
        link.style.left = (left / viewport.width * 100) + "%";
        link.style.top = (top / viewport.height * 100) + "%";
        link.style.width = ((right - left) / viewport.width * 100) + "%";
        link.style.height = ((bottom - top) / viewport.height * 100) + "%";
        link.setAttribute("aria-label", annotation.title || (targetPage
          ? "Ir a la página " + targetPage
          : "Abrir enlace"));
        if (targetPage) {
          link.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (pageFlip) pageFlip.flip(targetPage - 1);
          });
        } else {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        ["pointerdown", "mousedown", "touchstart"].forEach(function (eventName) {
          link.addEventListener(eventName, function (event) {
            event.stopPropagation();
          });
        });
        link.addEventListener("click", function (event) {
          event.stopPropagation();
        });
        linkFragment.append(link);
      }
      if (token !== loadToken) return;
      linkLayer.append(linkFragment);
      pageElement.replaceChildren(canvas, linkLayer);

      failedPages.delete(pageNumber);
      if (failedPages.size === 0 && errorElement.textContent === renderErrorMessage) {
        errorElement.hidden = true;
      }
    })();
    renderedPages.set(pageNumber, renderPromise);
    return renderPromise.catch(function (error) {
      if (renderedPages.get(pageNumber) === renderPromise) renderedPages.delete(pageNumber);
      throw error;
    });
  }

  function renderNearCurrentPage() {
    if (!pageFlip || !pdfDocument) return;
    const firstPage = pageFlip.getCurrentPageIndex() + 1;
    const pageCount = pdfDocument.numPages;
    const token = loadToken;
    const pagesToRender = new Set([firstPage - 1, firstPage, firstPage + 1, firstPage + 2, firstPage + 3]);
    pagesToRender.forEach(function (pageNumber) {
      if (pageNumber >= 1 && pageNumber <= pageCount) {
        renderPage(pageNumber, token).catch(function () {
          if (token === loadToken) {
            failedPages.add(pageNumber);
            setError(renderErrorMessage);
          }
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
    failedPages = new Set();
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