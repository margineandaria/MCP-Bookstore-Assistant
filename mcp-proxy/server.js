import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';


const aplicatieLibrarie = express();
aplicatieLibrarie.use(cors());

const asistentCarti = new Server({
  name: "ServerCartiMCP_Proiect",
  version: "1.0.0"
}, {
  capabilities: { tools: {} }
});

asistentCarti.setRequestHandler(ListToolsRequestSchema, async () => {
  const listaUnelte = [
    {
      name: "citire_carte_json",
      description: "Cauta o carte dupa titlu (sau parte din titlu) in stocul librariilor Cărturești (JSON-Server). Returneaza titlu, autor, gen, pret, stoc si detaliile librariei (numeLibrarie, adresa, program). Folosit pentru a afla AUTORUL unei carti si LIBRARIA unde se gaseste. Cautarea este partiala - 'Harry Potter' va gasi 'Harry Potter și Piatra Filozofală'. IMPORTANT: Pastreaza diacriticele.",
      inputSchema: { type: "object", properties: { titlu: { type: "string" } }, required: ["titlu"] }
    },
    {
      name: "adaugare_carte_json",
      description: "Adauga o carte noua in stocul unei librarii Cărturești (JSON-Server).",
      inputSchema: { type: "object", properties: { id: { type: "number" }, titlu: { type: "string" }, autor: { type: "string" }, gen: { type: "string" }, pret: { type: "number" }, stoc: { type: "number" }, locatieId: { type: "number" } }, required: ["id", "titlu", "autor", "gen", "pret", "stoc", "locatieId"] }
    },
    {
      name: "citire_autor_graphql",
      description: "Cauta un autor dupa nume in baza GraphQL si returneaza id, nationalitate, genPreferat, anDebut SI lista cartilor scrise de el. Foloseste-l cand utilizatorul intreaba despre cartile unui autor. Poate fi inlantuit dupa 'citire_carte_json' (autorul cartii -> detaliile autorului) sau inainte de 'citire_editura_autor_rdf4j' (autor -> editura). IMPORTANT: Pastreaza diacriticele (ex: 'Mircea Eliade', 'George Călinescu').",
      inputSchema: { type: "object", properties: { nume: { type: "string" } }, required: ["nume"] }
    },
    {
      name: "adaugare_autor_graphql",
      description: "Adauga un autor nou in baza GraphQL. ID generat automat.",
      inputSchema: { type: "object", properties: { nume: { type: "string" }, nationalitate: { type: "string" }, genPreferat: { type: "string" }, anDebut: { type: "number" } }, required: ["nume", "nationalitate", "genPreferat", "anDebut"] }
    },
    {
      name: "citire_editura_autor_rdf4j",
      description: "Returneaza editura la care publica un autor anume, pe baza numelui autorului (RDF4J / SPARQL). Foloseste-l cand utilizatorul intreaba 'unde publica autorul X' sau 'la ce editura a fost publicata cartea Y' (in acest caz, mai intai apeleaza 'citire_carte_json' ca sa afli autorul cartii, apoi acest tool cu numele autorului). IMPORTANT: Pastreaza diacriticele in numele autorului.",
      inputSchema: { type: "object", properties: { numeAutor: { type: "string" } }, required: ["numeAutor"] }
    },
    {
      name: "citire_autori_dupa_editura_rdf4j",
      description: "Returneaza autorii (id si nume) care publica la o anumita editura (RDF4J). Edituri valide: 'Editura Arthur', 'Grupul Editorial RAO', 'Editura Litera', 'Bookzone', 'Editura Epica', 'Editura Nemira', 'Editura Humanitas', 'Lifestyle Publishing'.",
      inputSchema: { type: "object", properties: { numeEditura: { type: "string" } }, required: ["numeEditura"] }
    },
    {
      name: "adaugare_autor_rdf4j",
      description: "Adauga un autor nou in graful RDF4J si il afiliaza la o editura existenta.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, nume: { type: "string" }, numeEditura: { type: "string" } }, required: ["id", "nume", "numeEditura"] }
    },
    {
      name: "citire_locatie_librarie",
      description: "Returneaza detaliile unei librarii Cărturești (numeLibrarie, adresa, program) pe baza id-ului. Util doar daca cunoasteti deja locatieId; in mod normal 'citire_carte_json' returneaza deja aceste detalii.",
      inputSchema: { type: "object", properties: { locatieId: { type: "number" } }, required: ["locatieId"] }
    }
  ];

  return { tools: listaUnelte };
});

asistentCarti.setRequestHandler(CallToolRequestSchema, async (cerereModel) => {
  const numeActiune = cerereModel.params.name;
  const argumente = cerereModel.params.arguments;

  console.log(`\n[Log Server] AI a chemat funcția: >> ${numeActiune} <<`);
  console.log(`[Log Server] Date trimise:`, argumente);

  try {
    switch (numeActiune) {
      
      case "citire_carte_json": {
        let textCautat = encodeURIComponent(argumente.titlu.trim());
        let raspunsCarti = await axios.get(`http://localhost:4000/carti?titlu_like=${textCautat}`);
        let listaCarti = raspunsCarti.data;

        let rezultateImbogatite = await Promise.all(listaCarti.map(async (carte) => {
          try {
            let detaliiLocatie = await axios.get(`http://localhost:4000/locatii/${carte.locatieId}`);
            return { ...carte, librarie: detaliiLocatie.data };
          } catch (e) {
            return { ...carte, librarie: null }; 
          }
        }));
        return { content: [{ type: "text", text: JSON.stringify(rezultateImbogatite) }] };
      }

      case "adaugare_carte_json": {
        let raspunsAdaugare = await axios.post(`http://localhost:4000/carti`, argumente);
        return { content: [{ type: "text", text: JSON.stringify(raspunsAdaugare.data) }] };
      }

      case "citire_autor_graphql": {
        let numeAutor = argumente.nume.trim();
        let interogareAutor = `query { allAutoris(filter: {nume: "${numeAutor}"}) { id nume nationalitate genPreferat anDebut } }`;
        let reqAutor = await axios.post(`http://localhost:3000`, { query: interogareAutor });
        let listaAutoriGasiti = reqAutor.data?.data?.allAutoris || [];

        if (listaAutoriGasiti.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ gasit: false, mesaj: `Nu avem date despre ${numeAutor}.` }) }] };
        }

        let autorulNostru = listaAutoriGasiti[0];

        let interogareCarti = `query { allCartis(filter: {autoriId: ${autorulNostru.id}}) { id titlu gen anPublicare pret } }`;
        let reqCarti = await axios.post(`http://localhost:3000`, { query: interogareCarti });
        let cartiPublicate = reqCarti.data?.data?.allCartis || [];

        let raspunsFinalGraph = { ...autorulNostru, carti: cartiPublicate };
        return { content: [{ type: "text", text: JSON.stringify(raspunsFinalGraph) }] };
      }

      case "adaugare_autor_graphql": {
        let mutatatieGraphQL = `mutation {
          createAutori(
            nume: "${argumente.nume}",
            nationalitate: "${argumente.nationalitate}",
            genPreferat: "${argumente.genPreferat}",
            anDebut: ${argumente.anDebut}
          ) { id nume }
        }`;
        let raspunsCreare = await axios.post(`http://localhost:3000`, { query: mutatatieGraphQL });
        return { content: [{ type: "text", text: JSON.stringify(raspunsCreare.data) }] };
      }

      case "citire_editura_autor_rdf4j": {
        let autorCautat = argumente.numeAutor.trim();
        let qSparql = `PREFIX schema: <https://schema.org/> SELECT ?numeEditura WHERE { ?a a schema:Person ; schema:name "${autorCautat}" ; schema:affiliation ?ed . ?ed schema:name ?numeEditura }`;
        let reqRdf4j = await axios.get(`http://localhost:8080/rdf4j-server/repositories/grafexamen`, {
          params: { query: qSparql },
          headers: { "Accept": "application/sparql-results+json" }
        });
        
        let listaEdituri = reqRdf4j.data.results.bindings.map(rand => rand.numeEditura.value);
        return { content: [{ type: "text", text: JSON.stringify(listaEdituri) }] };
      }

      case "citire_autori_dupa_editura_rdf4j": {
        let edituraCautata = argumente.numeEditura.trim();
        let qSparqlEditura = `PREFIX schema: <https://schema.org/> SELECT ?id ?nume WHERE { ?ed a schema:Organization ; schema:name "${edituraCautata}" . ?a schema:affiliation ?ed ; schema:identifier ?id ; schema:name ?nume }`;
        let raspunsRdf4j = await axios.get(`http://localhost:8080/rdf4j-server/repositories/grafexamen`, {
          params: { query: qSparqlEditura },
          headers: { "Accept": "application/sparql-results+json" }
        });
        return { content: [{ type: "text", text: JSON.stringify(raspunsRdf4j.data.results.bindings) }] };
      }

      case "adaugare_autor_rdf4j": {
        let formatareSlug = argumente.numeEditura.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
        let scriptInserare = `PREFIX schema: <https://schema.org/> PREFIX ex: <http://proiect-daria-larisa.ro/> INSERT DATA { ex:Autor${argumente.id} a schema:Person ; schema:identifier "${argumente.id}" ; schema:name "${argumente.nume}" ; schema:affiliation ex:Ed_${formatareSlug} . }`;
        
        await axios.post(`http://localhost:8080/rdf4j-server/repositories/grafexamen/statements`, scriptInserare, {
          headers: { "Content-Type": "application/sparql-update" }
        });
        return { content: [{ type: "text", text: "OK: Autor inregistrat in baza de date RDF4J" }] };
      }

      case "citire_locatie_librarie": {
        let infoLocatie = await axios.get(`http://localhost:4000/locatii/${argumente.locatieId}`);
        return { content: [{ type: "text", text: JSON.stringify(infoLocatie.data) }] };
      }

      default:
        throw new Error("Tool-ul cerut nu exista in lista!");
    }

  } catch (eroare) {
    console.error(`[!!!] EROARE in executia tool-ului ${numeActiune}:`, eroare.message);
    return {
      content: [{ type: "text", text: `A intervenit o eroare la interogarea bazei de date: ${eroare.message}` }]
    };
  }
});

let conexiuneActivaSse;

aplicatieLibrarie.get("/sse", async (req, res) => {
  console.log(">> A fost inregistrata o noua conexiune pe canalul SSE <<");
  if (conexiuneActivaSse) {
    try { await asistentCarti.close(); } catch (ignoramEroarea) {}
  }
  conexiuneActivaSse = new SSEServerTransport("/message", res);
  await asistentCarti.connect(conexiuneActivaSse);
});

aplicatieLibrarie.post("/message", async (req, res) => {
  if (conexiuneActivaSse) { 
    await conexiuneActivaSse.handlePostMessage(req, res); 
  }
});

const PORT = 5050;
aplicatieLibrarie.listen(PORT, () => {
  console.log(`Serverul MCP (Asistent Carti) ruleaza cu succes pe portul ${PORT}`);
});