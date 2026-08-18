// 1. Contador de Urgência
let timeInSeconds = (1 * 3600) + (59 * 60) + 54; // 01:59:54

const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');

setInterval(() => {
    if (timeInSeconds <= 0) timeInSeconds = 2 * 3600; // Reseta se zerar (apenas para o exemplo)
    timeInSeconds--;
    
    const h = Math.floor(timeInSeconds / 3600);
    const m = Math.floor((timeInSeconds % 3600) / 60);
    const s = timeInSeconds % 60;
    
    if(hoursEl) hoursEl.innerText = String(h).padStart(2, '0');
    if(minutesEl) minutesEl.innerText = String(m).padStart(2, '0');
    if(secondsEl) secondsEl.innerText = String(s).padStart(2, '0');
}, 1000);

// 2. Acordeão do FAQ
document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
        const item = question.parentElement;
        
        // Fecha as outras abas caso queira que apenas uma fique aberta
        document.querySelectorAll('.faq-item').forEach(otherItem => {
            if (otherItem !== item) {
                otherItem.classList.remove('active');
            }
        });

        item.classList.toggle('active');
    });
});