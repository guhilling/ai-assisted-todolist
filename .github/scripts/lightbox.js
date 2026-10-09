// Click an image in the documentation to see it almost filling the window; click anywhere,
// press Escape or use the close button to go back. build-site.py copies this to assets/ and every
// page it writes loads it.
//
// A native <dialog>: shown modal, it keeps focus inside, Escape closes it without a line of code
// here, and focus returns to the image afterwards. An image inside a link is left alone -- a badge
// goes where it links -- as is a decorative one, and a <picture> opens in the variant shown, light
// or dark (currentSrc).
(() => {
  const images = [...document.querySelectorAll('main img, .prose img')]
    // An empty alt marks an image as decoration -- the logo -- which there is nothing to see in.
    .filter((image) => image.alt && !image.closest('a') && !image.closest('.masthead'))
  if (images.length === 0) {
    return
  }

  const dialog = document.createElement('dialog')
  dialog.className = 'lightbox'
  dialog.setAttribute('aria-label', 'Enlarged image')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'lightbox__close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '×'
  const shown = document.createElement('img')
  shown.className = 'lightbox__image'
  dialog.append(close, shown)
  document.body.append(dialog)

  // Anywhere in it closes it, the image and the button included.
  dialog.addEventListener('click', () => dialog.close())

  const open = (image) => {
    shown.src = image.currentSrc || image.src
    shown.alt = image.alt
    dialog.showModal()
  }

  for (const image of new Set(images)) {
    image.classList.add('lightbox-target')
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', `Enlarge: ${image.alt}`)
    image.addEventListener('click', () => open(image))
    image.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open(image)
      }
    })
  }
})()
