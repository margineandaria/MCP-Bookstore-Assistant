import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const FISIER_CURENT = fileURLToPath(import.meta.url);
const DIRECTOR_CURENT = path.dirname(FISIER_CURENT);

const serverAplicație = express();
serverAplicație.use(cors());
serverAplicație.use(express.json());

serverAplicație.use(express.static(path.join(DIRECTOR_CURENT, '..', 'frontend')));


const CHEIE_API = "AIzaSyDNjyUl3ie9oxipFTeo_CgPPbAKL3NLutE"; 
const instantaGemini = new GoogleGenerativeAI(CHEIE_API);
const modelCarturesti = instantaGemini.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  systemInstruction: "Ești un asistent virtual pentru proiectul nostru. ROLUL TĂU STRICT este să răspunzi la întrebări DOAR folosind datele extrase prin intermediul uneltelor (tools) puse la dispoziție. NU folosi cultura ta generală și nu inventa informații. Dacă primești o întrebare și nu găsești răspunsul apelând bazele de date, răspunde exact așa: 'Ne pare rău, dar nu avem această informație în bazele noastre de date.'"
});


const transportLocal = new SSEClientTransport(new URL("http://localhost:5050/sse"));
const clientAsistent = new Client(
  { name: "AsistentCarturesti", version: "1.0.0" },
  { capabilities: {} }
);


const pregatesteTooluriPentruAPI = (listaMcp) => {
  let declaratii = listaMcp.map(tool => {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    };
  });
  return [{ functionDeclarations: declaratii }];
};


const trimiteMesajSigur = async (sesiuneChat, textSauArray) => {
  let nrIncercare = 1;
  let maximIncercari = 3;

  while (nrIncercare <= maximIncercari) {
    try {
      let rezultatAsteptat = await sesiuneChat.sendMessage(textSauArray);
      return rezultatAsteptat;
    } catch (eroareGasita) {
      let eMesaj = eroareGasita.message || "";
      let eSupraincarcat = eMesaj.includes("503") || eMesaj.includes("overloaded");
      
      if (eSupraincarcat && nrIncercare < maximIncercari) {
        console.log(`[Atentie] Serverul Gemini e aglomerat. Asteptam putin... (Incercarea ${nrIncercare})`);
        await new Promise(resolve => setTimeout(resolve, 2000)); 
        nrIncercare++;
      } else {
        throw eroareGasita;
      }
    }
  }
};

serverAplicație.post('/chat', async (req, res) => {
  let mesajUtilizator = req.body.message || req.body.prompt;
  
  if (!mesajUtilizator) {
    return res.status(400).json({ reply: "Hei, n-ai scris nicio intrebare!" });
  }

  try {
    let detaliiTools = await clientAsistent.listTools();
    let unelteGemini = pregatesteTooluriPentruAPI(detaliiTools.tools);

    let sesiuneCurenta = modelCarturesti.startChat({ tools: unelteGemini });
    let raspunsDeLaModel = await trimiteMesajSigur(sesiuneCurenta, mesajUtilizator);

    const areNevoieDeTool = () => {
      let parti = raspunsDeLaModel.response.candidates[0].content.parts;
      return parti.find(element => element.functionCall) !== undefined;
    };

    while (areNevoieDeTool()) {
      let listaParti = raspunsDeLaModel.response.candidates[0].content.parts;
      let detaliuApel = listaParti.find(p => p.functionCall).functionCall;

      console.log(`[Log] Modelul cere date folosind functia: ${detaliuApel.name}`);
      
      let outputDinMcp = await clientAsistent.callTool({
        name: detaliuApel.name,
        arguments: detaliuApel.args
      });

      let dateTrimiseInapoi = [{
        functionResponse: {
          name: detaliuApel.name,
          response: { result: outputDinMcp.content[0].text }
        }
      }];

      raspunsDeLaModel = await trimiteMesajSigur(sesiuneCurenta, dateTrimiseInapoi);
    }

    let mesajFinalAsezat = raspunsDeLaModel.response.text();
    res.json({ reply: mesajFinalAsezat });

  } catch (problema) {
    console.error("!!! Eroare prinsa in /chat:", problema);
    res.status(500).json({ reply: "Scuze, am intampinat o eroare: " + problema.message });
  }
})

const PORT_SERVER = 8000;
serverAplicație.listen(PORT_SERVER, () => {
  console.log(`[ OK ] Serverul a pornit! Intra pe http://localhost:${PORT_SERVER}`);

  clientAsistent.connect(transportLocal)
    .then(() => console.log("[ OK ] Ne-am conectat la baza MCP (port 5050)."))
    .catch(eroareMcp => console.error("[ EROARE ] Nu s-a putut conecta la MCP:", eroareMcp.message));
});