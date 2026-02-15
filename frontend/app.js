document.addEventListener('DOMContentLoaded', () => {
    const btnCollapse = document.getElementById('btn-collapse');
    const logs = document.getElementById('system-logs');
    const nodes = {
        north: document.getElementById('node-north'),
        south: document.getElementById('node-south'),
        east: document.getElementById('node-east'),
        west: document.getElementById('node-west')
    };

    function addLog(message) {
        const li = document.createElement('li');
        li.textContent = `> ${new Date().toLocaleTimeString()} - ${message}`;
        logs.appendChild(li);
        logs.scrollTop = logs.scrollHeight;
    }

    async function initiateCollapse() {
        btnCollapse.disabled = true;
        btnCollapse.textContent = "Harnessing Entropy...";
        addLog("Initiating Quantum Collapse Sequence...");

        // Simulate ANU API call delay
        await new Promise(r => setTimeout(r, 1500));
        addLog("Connected to ANU Quantum Vacuum Source.");

        // Simulate Wave Function Collapse
        addLog("Wave Function Collapsed. Master Seed Generated.");
        document.querySelector('.quantum-fluctuation').style.boxShadow = "0 0 50px #fff, 0 0 100px #00f3ff";

        await new Promise(r => setTimeout(r, 1000));
        addLog("Erasing Seed from Memory...");
        addLog("Splitting Secret into Cardinal Shards...");

        // Simulate Distribution
        const directions = ['north', 'south', 'east', 'west'];
        for (const dir of directions) {
            await new Promise(r => setTimeout(r, 800));
            activateNode(dir);
        }

        btnCollapse.textContent = "Tree Secured";
        addLog("VAULT ESTABLISHED. Root secured across 4 Cardinal Nodes.");
    }

    function activateNode(direction) {
        const node = nodes[direction];
        node.classList.add('active');
        node.querySelector('.status').textContent = "ONLINE - SECURED";
        addLog(`Node [${direction.toUpperCase()}] verification complete. Shard stored.`);
    }

    btnCollapse.addEventListener('click', initiateCollapse);
});
