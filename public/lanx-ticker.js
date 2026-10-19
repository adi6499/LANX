// LANX recording clock (LANX 1.4.0). Timers in the window slow down when
// LANX is minimised; a worker's don't, so a recording keeps its picture.
let timer = null;
onmessage = (e) => {
  clearInterval(timer);
  timer = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null;
};
