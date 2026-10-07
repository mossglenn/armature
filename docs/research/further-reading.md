# Further reading: follow-up literature search

**Date:** 2026-10-06 · Companion to `learning-data-standards-precedents.md` and `adr-candidates.md`.

Eight follow-up topics, 85 sources. Every item was checked against a DOI record, publisher page or repository record by the searching agent. Items marked † had thinner checks (noted in the row). Nothing here duplicates the sources already cited in the precedents document. None of these are in Zotero yet.

## Strongest picks

| Source | Why it matters most |
| --- | --- |
| Shipman & Marshall (1999), *Formality Considered Harmful* | The base for progressive formalization: why people resist structure required up front. |
| Shipman & McCall (1997), rationale emerging from design communication | A near-exact precedent for free-text design notes becoming findings and attestations. |
| Mislevy (2003) and Mislevy, Steinberg & Almond (2003), Evidence-Centered Design | Claim, evidence and warrant semantics for alignment assertions, in the assessment literature Armature's users know. |
| Bowker & Star (1999), *Sorting Things Out* | Every standard takes a point of view; the strongest grounding for pluralism over neutrality. |
| Totino & Kessler (2024), the original LEED tracker paper (JAID) | Armature's closest neighbour, with templates, not yet cited in the paper. |
| ICICLE, *Learning Engineering Process* page | The field's own process model instruments learner data but not design decisions. Direct evidence for the gap claim. |
| Harden (2001), AMEE Guide 21 on curriculum mapping | "The essence of a curriculum map is not the nodes but the links": relation-first design, from medical education. |
| Petre (2013) and Hutchinson, Whittle & Rouncefield (2014) | Outside education, executable modelling succeeded only partially and informally. IMS LD's fate was not unique. |
| Zhao et al. (2024) and Zhou et al. (2025) | LLMs can draft rationale but with low precision; LLM-proposed rationale should be an assertion a person attests. |

## 1. Pedagogical pluralism and the neutrality claim

| Source | Why it matters for Armature |
| --- | --- |
| Koper (2001). Modeling units of study from a pedagogical perspective: the pedagogical meta-model behind EML. OUNL working paper. [link](https://research.ou.nl/files/1045171/Pedagogical%20metamodel%20behind%20EMLv2.pdf) | Origin of the "express any pedagogy" claim behind EML and IMS LD; the position pluralism replaces. |
| Friesen (2004). Learning objects and standards: pedagogical neutrality and engagement. *ICALT 2004*. [10.1109/ICALT.2004.1357756](https://doi.org/10.1109/ICALT.2004.1357756) | The most direct critique of neutrality claims in learning technology standards. |
| Caeiro, Anido & Llamas (2003). A critical analysis of IMS Learning Design. *Designing for Change in Networked Learning Environments*. [10.1007/978-94-017-0195-2_44](https://doi.org/10.1007/978-94-017-0195-2_44) | Finds IMS LD's "neutral" structures still carry a particular workflow model. |
| Bowker & Star (1999). *Sorting Things Out: Classification and Its Consequences*. MIT Press. [10.7551/mitpress/6352.001.0001](https://doi.org/10.7551/mitpress/6352.001.0001) | "Each standard and each category valorizes some point of view and silences another." |
| Friedman (1996). Value-sensitive design. *Interactions* 3(6). [10.1145/242485.242493](https://doi.org/10.1145/242485.242493) | A method for stating the values built into a system, rather than claiming none. |
| Hamilton & Friesen (2013). Online education: a science and technology studies perspective. *CJLT* 39(2). [10.21432/T2001C](https://doi.org/10.21432/T2001C) | Rejects the instrumentalist view of technology that underlies neutrality claims. |
| Oliver (2011). Technological determinism in educational technology research. *JCAL* 27(5). [10.1111/j.1365-2729.2011.00406.x](https://doi.org/10.1111/j.1365-2729.2011.00406.x) | Alternatives to determinism for describing how an infrastructure and its users shape each other. |
| Selwyn (2010). Looking beyond learning: notes towards the critical study of educational technology. *JCAL* 26(1). [10.1111/j.1365-2729.2009.00338.x](https://doi.org/10.1111/j.1365-2729.2009.00338.x) | Infrastructure choices are value choices. |
| Knight, Buckingham Shum & Littleton (2014). Epistemology, assessment, pedagogy: where learning meets analytics in the middle space. *JLA* 1(2). [10.18608/jla.2014.12.3](https://doi.org/10.18608/jla.2014.12.3) | Analytics encode epistemic and pedagogic commitments; relevant to outcome-to-design queries. |
| Biesta (2010). Why "what works" still won't work. *Studies in Philosophy and Education* 29(5). [10.1007/s11217-010-9191-x](https://doi.org/10.1007/s11217-010-9191-x) | Educational decisions are value-based; keep rationale and values beside evidence links. |
| Perrotta & Williamson (2018). The social life of learning analytics. *Learning, Media and Technology* 43(1). [10.1080/17439884.2016.1182927](https://doi.org/10.1080/17439884.2016.1182927) | Analytic classifications shape what they measure: a caution for metric-to-objective tracing. |

## 2. Why descriptive and executable representations fared differently

| Source | Why it matters for Armature |
| --- | --- |
| Shipman & Marshall (1999). Formality considered harmful. *CSCW* 8(4). [10.1023/A:1008716330212](https://doi.org/10.1023/A:1008716330212) | Cognitive overhead, tacit knowledge and premature commitment explain resistance to required structure. |
| Shipman & McCall (1994). Supporting knowledge-base evolution with incremental formalization. *CHI '94*. [10.1145/191666.191768](https://doi.org/10.1145/191666.191768) | Incremental formalization: the system suggests structure as informal content grows. |
| Shipman & McCall (1999). Incremental formalization with the hyper-object substrate. *ACM TOIS* 17(2). [10.1145/306686.306690](https://doi.org/10.1145/306686.306690) | Architecture precedent for promoting free text to typed nodes and edges. |
| Marshall & Shipman (2003). Which semantic web? *Hypertext 2003*. [10.1145/900051.900063](https://doi.org/10.1145/900051.900063) | Formal, machine-reasoning ambitions versus modest descriptive ones: the same choice Armature makes. |
| Fischer, McCall, Ostwald, Reeves & Shipman (1994). Seeding, evolutionary growth and reseeding. *CHI '94 Companion*. [10.1145/259963.260387](https://doi.org/10.1145/259963.260387) † author list from memory; DOI and title confirmed | Ship a coarse seed schema and grow it through use. |
| Gibbons & Brewer (2005). Elementary principles of design languages and design notation systems for instructional design. *Innovations in Instructional Technology*. [10.4324/9781410613684-16](https://doi.org/10.4324/9781410613684-16) | Source of the computable versus non-computable dimension of design languages. |
| Waters & Gibbons (2004). Design languages, notation systems, and instructional technology: a case study. *ETR&D* 52(2). [10.1007/BF02504839](https://doi.org/10.1007/BF02504839) | How notation shapes what designers can see and say. |
| Derntl, Neumann, Griffiths & Oberhuemer (2010). Investigating teachers' understanding of IMS Learning Design: yes they can. *EC-TEL 2010*. [10.1007/978-3-642-16020-2_5](https://doi.org/10.1007/978-3-642-16020-2_5) | Teachers matched 78% of an expert solution on paper; the cost of executability, not the concepts, was the barrier. |
| Dagnino et al. (2018). Exploring teachers' needs and the existing barriers to the adoption of learning design methods and tools. *BJET*. [10.1111/bjet.12695](https://doi.org/10.1111/bjet.12695) | Most barriers to learning design tools are contextual and institutional. |
| Rustici (2008). SCORM: the baby and the bathwater. LETSI white paper. [PDF](https://scorm.com/wp-content/assets/LETSI-white-papers/LETSI%20White%20Papers%20-%20Rustici%20-%20SCORM_The_Baby_and_the_Bathwater.pdf) † grey literature | Simple Sequencing judged "overly complex, fragile", with cost exceeding benefit. |
| Falconer & Littlejohn (2007). Designing for blended learning, sharing and reuse. *JFHE* 31(1). [10.1080/03098770601167914](https://doi.org/10.1080/03098770601167914) | Practitioners wanted several light views of a design, shown as an evolving process. |
| Hutchinson, Whittle & Rouncefield (2014). Model-driven engineering practices in industry. *Science of Computer Programming* 89. [10.1016/j.scico.2013.03.017](https://doi.org/10.1016/j.scico.2013.03.017) | Executable modelling succeeds on organizational fit and gradual introduction, not technical power. |
| Petre (2013). UML in practice. *ICSE 2013*. [10.1109/ICSE.2013.6606618](https://doi.org/10.1109/ICSE.2013.6606618) | Most professionals used UML informally, as sketches. |
| zur Muehlen & Recker (2008). How much language is enough? Theoretical and practical use of BPMN. *CAiSE 2008*. [10.1007/978-3-540-69534-9_35](https://doi.org/10.1007/978-3-540-69534-9_35) | Real models use a small core of the notation: a coarse core vocabulary is enough. |
| Peleg et al. (2003). Comparing computer-interpretable guideline models. *JAMIA* 10(1). [10.1197/jamia.M1135](https://doi.org/10.1197/jamia.M1135) | The encoding work and loss of meaning executable clinical guidelines demand. |
| Shiffman, Michel, Essaihi & Thornquist (2004). Bridging the guideline implementation gap. *JAMIA* 11(5). [10.1197/jamia.M1444](https://doi.org/10.1197/jamia.M1444) | Mark up the descriptive document first, formalize later: a medical precedent for descriptive-first. |

## 3. Coarse versus fine-grained data

| Source | Why it matters for Armature |
| --- | --- |
| Feng, Heffernan, Heffernan & Mani (2009). Using mixed-effects modeling to analyze different grain-sized skill models. *IEEE TLT* 2(2). [10.1109/TLT.2009.17](https://doi.org/10.1109/TLT.2009.17) | Finer skill models predicted better only with dense data: when finer grain pays. |
| Pardos, Heffernan, Anderson & Heffernan (2007). The effect of model granularity on student performance prediction. *UM 2007*. [10.1007/978-3-540-73078-1_60](https://doi.org/10.1007/978-3-540-73078-1_60) | A direct test of knowledge-component granularity. |
| Cen, Koedinger & Junker (2006). Learning Factors Analysis. *ITS 2006*. [10.1007/11774303_17](https://doi.org/10.1007/11774303_17) | The right grain is found from data by splitting and merging, not fixed up front. |
| Liu & Koedinger (2017). Closing the loop: automated data-driven cognitive model discoveries. *JEDM* 9(1). [PDF](https://jedm.educationaldatamining.org/index.php/JEDM/article/download/212/pdf_29) † no DOI found | A data-found refinement led to redesign and learning gains (d = 0.47): Narrative 1's loop. |
| Sinharay, Puhan & Haberman (2011). An NCME instructional module on subscores. *EM:IP* 30(3). [10.1111/j.1745-3992.2011.00208.x](https://doi.org/10.1111/j.1745-3992.2011.00208.x) | Fine-grained subscores often lack reliability: a caution against over-reading per-objective metrics. |
| Porter (2002). Measuring the content of instruction. *Educational Researcher* 31(7). [10.3102/0013189X031007003](https://doi.org/10.3102/0013189X031007003) | A deliberately coarse topic-by-demand matrix buys comparability across curriculum, instruction and assessment. |
| Martone & Sireci (2009). Evaluating alignment between curriculum, assessment, and instruction. *RER* 79(4). [10.3102/0034654309341375](https://doi.org/10.3102/0034654309341375) | Reviews alignment methods and how standard granularity affects reliability. |
| Wilson (2009). Measuring progressions. *JRST* 46(6). [10.1002/tea.20318](https://doi.org/10.1002/tea.20318) | Grain size as an explicit design choice linking progressions to assessment. |
| Currier, Barton, O'Beirne & Ryan (2004). Quality assurance for digital learning object repositories. *RLT* 12(1). [10.3402/rlt.v12i1.11223](https://doi.org/10.3402/rlt.v12i1.11223) | Detailed metadata was not reliably produced by authors: the capture cost of fine grain. |
| Law & Liang (2020). A multilevel framework and method for learning analytics integrated learning design. *JLA* 7(3). [10.18608/jla.2020.73.8](https://doi.org/10.18608/jla.2020.73.8) | Several grains (curriculum, unit, task) held in one model. |

## 4. Assertions in the CaSS model and related claim-evidence models

| Source | Why it matters for Armature |
| --- | --- |
| Mislevy, Steinberg & Almond (2003). On the structure of educational assessments. *Measurement* 1(1). [10.1207/S15366359MEA0101_02](https://doi.org/10.1207/S15366359MEA0101_02) | Evidence-Centered Design separates claims, evidence and tasks, mapping onto objective, alignment assertion and item. |
| Mislevy (2003). Substance and structure in assessment arguments. *Law, Probability and Risk* 2(4). [10.1093/lpr/2.4.237](https://doi.org/10.1093/lpr/2.4.237) | Toulmin's claim, data, warrant and rebuttal applied to assessment: a template for alignment assertions. |
| Mislevy, Almond & Lukas (2003). A brief introduction to Evidence-Centered Design. ETS Research Report. [10.1002/j.2333-8504.2003.tb01908.x](https://doi.org/10.1002/j.2333-8504.2003.tb01908.x) | The short, citable explainer of ECD's layers. |
| Almond, Steinberg & Mislevy (2002). Enhancing the design and delivery of assessment systems: a four-process architecture. *JTLA* 1(5). [link](https://ejournals.bc.edu/index.php/jtla/article/view/1671) | Separates observation from inference, mirroring metric to item to objective in Narrative 1. |
| Kane (2013). Validating the interpretations and uses of test scores. *JEM* 50(1). [10.1111/jedm.12000](https://doi.org/10.1111/jedm.12000) | Argument-based validity: each inference is a claim that needs backing. |
| Robson et al. (2022). Mining artificially generated data to estimate competency. *EDM 2022*. [10.5281/zenodo.6852926](https://doi.org/10.5281/zenodo.6852926) | A peer-reviewed account of CaSS assertion processing with an auditable evidence chain. |
| Robson et al. (2020). Competency framework development process report. ADL / DTIC. [PDF](https://apps.dtic.mil/sti/pdfs/AD1094921.pdf) | How CaSS frameworks and assertion stores are built from many sources. |
| W3C (2025). Verifiable Credentials Data Model v2.0. [link](https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/) | Issuer, subject and claim with evidence and validity: a serialization for attestations that travel. |
| Vrandečić & Krötzsch (2014). Wikidata: a free collaborative knowledgebase. *CACM* 57(10). [10.1145/2629489](https://doi.org/10.1145/2629489) | Coexisting statements with qualifiers, references and ranks. |
| Piscopo, Kaffee, Phethean & Simperl (2017). Provenance information in a collaborative knowledge graph. *ISWC 2017*. [10.1007/978-3-319-68288-4_32](https://doi.org/10.1007/978-3-319-68288-4_32) | Evaluates whether references attached to claims are relevant and authoritative. |

## 5. Argumentation schemes for capturing design rationale

| Source | Why it matters for Armature |
| --- | --- |
| Walton, Reed & Macagno (2008). *Argumentation Schemes*. Cambridge UP. [10.1017/CBO9780511802034](https://doi.org/10.1017/CBO9780511802034) | 96 schemes with critical questions; use the questions as optional prompts, not required fields. |
| Atkinson, Bench-Capon & McBurney (2006). Computational representation of practical argument. *Synthese* 152(2). [10.1007/s11229-005-3488-2](https://doi.org/10.1007/s11229-005-3488-2) | One computable scheme (situation, action, goal, value) for "why this activity for this objective". |
| Shipman & McCall (1997). Integrating different perspectives on design rationale. *AI EDAM* 11(2). [10.1017/S089006040000192X](https://doi.org/10.1017/S089006040000192X) | Formalize rationale incrementally from ordinary design communication. |
| Conklin, Selvin, Buckingham Shum & Sierhuis (2001). Facilitated hypertext for collective sensemaking: 15 years on from gIBIS. *Hypertext '01*. [10.1145/504243.504246](https://doi.org/10.1145/504243.504246) | IBIS worked when a facilitator mapped live; an AI partner could take that role. |
| De Liddo, Sándor & Buckingham Shum (2012). Contested collective intelligence. *CSCW* 21(4–5). [10.1007/s10606-011-9155-x](https://doi.org/10.1007/s10606-011-9155-x) | Human versus machine annotation of claims: early semi-automated rationale extraction. |
| Conole et al. (2008). Visualising learning design to foster and support good practice and creativity. *Educational Media International* 45(3). [10.1080/09523980802284168](https://doi.org/10.1080/09523980802284168) | CompendiumLD: the closest prior art for rationale capture in learning design. |
| Christensen & Osguthorpe (2004). How do instructional-design practitioners make instructional-strategy decisions? *PIQ* 17(3). [10.1111/j.1937-8327.2004.tb00313.x](https://doi.org/10.1111/j.1937-8327.2004.tb00313.x) | Designers decide by brainstorming and peers more than formal theory; fit the vocabulary to real reasoning. |
| Dhaouadi, Oakes & Famelis (2024). Rationale dataset and analysis for the commit messages of the Linux kernel out-of-memory killer. *ICPC 2024*. [10.1145/3643916.3644413](https://doi.org/10.1145/3643916.3644413) | Commit messages as a low-burden home for rationale, extractable later. |
| Zhao et al. (2024). DRMiner: extracting latent design rationale from Jira issue logs. *ASE 2024*. [10.1145/3691620.3694982](https://doi.org/10.1145/3691620.3694982) | LLMs plus heuristics mine decisions and arguments from discussion threads. |
| Zhou et al. (2025). Using LLMs in generating design rationale for software architecture decisions. arXiv 2504.20781. [link](https://arxiv.org/abs/2504.20781) † preprint | Recall 0.63 to 0.72, precision about 0.27: LLM rationale must be attested by a person. |

## 6. Decision records outside software development

| Source | Why it matters for Armature |
| --- | --- |
| Sandoval (2014). Conjecture mapping. *JLS* 23(1). [10.1080/10508406.2013.778204](https://doi.org/10.1080/10508406.2013.778204) | An education-native model of explicit, linked design conjectures. |
| Reinholz (2017). Design trees: providing roots for revision in design-based research. *IJLT* 12(4). [link](https://www.inderscience.com/filter.php?aid=89907) | Nested levels from frameworks to assessment, traced during revision: close to Armature's graph plus history. |
| Regli, Hu, Atwood & Sun (2000). A survey of design rationale systems. *Engineering with Computers* 16. [10.1007/PL00013715](https://doi.org/10.1007/PL00013715) | The standard taxonomy for placing Armature among rationale systems. |
| Bracewell, Ahmed & Wallace (2004). DRed and design folders. *ASME DETC 2004*. [link](https://orbit.dtu.dk/en/publications/dred-and-design-folders-a-way-of-capturing-storing-and-passing-on/) | Aerospace designers were "surprisingly willing" to use graph-based rationale linked to files. |
| Wyke, Jensen & Svidt (2021). Design rationale documentation and exchange in the Danish AEC industry. *CIB W78*. [PDF](https://itc.scix.net/pdfs/w78-2021-paper-055.pdf) | Building design shows the same uncaptured-rationale gap and its costs. |
| Öz & Öz (2026). Making rejected and non-selected architectural design decisions traceable. *Buildings* 16(12). [10.3390/buildings16122332](https://doi.org/10.3390/buildings16122332) | Gives rejected alternatives first-class status in decision records. |
| Gutierrez Lopez et al. (2017). Capturing design decision rationale with decision cards. *INTERACT 2017*. [10.1007/978-3-319-67744-6_29](https://doi.org/10.1007/978-3-319-67744-6_29) | What UX designers think is worth recording. |
| Thoughtworks (2023). Design system decision records. Technology Radar vol. 34. [link](https://www.thoughtworks.com/radar/techniques/design-system-decision-records) † industry source | ADRs moving into product and UX design. |
| Buchgeher et al. (2023). Using architecture decision records in open source projects. *IEEE Access* 11. [10.1109/ACCESS.2023.3287654](https://doi.org/10.1109/ACCESS.2023.3287654) | Realistic adoption: low but growing, often only one to five records. |
| Ahmeti, Linder, Groner & Wohlrab (2024). Introducing architecture decision records in practice. *ECSA 2024*. [10.1007/978-3-031-70797-1_22](https://doi.org/10.1007/978-3-031-70797-1_22) | Where records are stored strongly affects their use. |
| Liu, Althoff & Heer (2020). Paths explored, paths omitted, paths obscured. *CHI 2020*. [link](https://arxiv.org/abs/1910.13602) | Unrecorded analytic decisions distort reporting: the reproducibility case for recording decisions. |

## 7. LEED and learning-engineering decision tracking

| Source | Why it matters for Armature |
| --- | --- |
| Totino & Kessler (2024). "Why did we do that?" A systematic approach to tracking decisions. *JAID* 13(2). [10.59668/1269.15630](https://doi.org/10.59668/1269.15630) | The original LEED tracker paper, with templates. |
| Ali, Lis, et al. (2024). Using the LEED Tracker in a pK-12 context. *ICICLE 2024 Proceedings*. [link](https://icicle.edtechbooks.org/icicle_2024/AliLisetal) † full author list not verified | LEED carried over beyond MIT. |
| Goodell, Kessler, Wiltrout & Avello (2021). Learning engineering @ scale. *L@S 2021*. [10.1145/3430895.3460875](https://doi.org/10.1145/3430895.3460875) | Links learning engineering to scale infrastructure. |
| Azad, Goodell, Kessler, Craig & Saliah-Hassane (2025). Learning engineering: a system design approach for engineering education. *ASEE 2025*. [10.18260/1-2--56910](https://doi.org/10.18260/1-2--56910) | Closed-loop framing; the loop has no stored record of the design state. |
| Baker, Boser & Snow (2022). Learning engineering: where the field is at. *Technology, Mind, and Behavior* 3(1). [10.1037/tmb0000058](https://doi.org/10.1037/tmb0000058) | Field research agenda; check whether it names design-time infrastructure. |
| IEEE ICICLE (2025). Learning Engineering Process. [link](https://sagroups.ieee.org/icicle/learning-engineering-process) | The process model instruments learner data, not design decisions. |
| Craig, Goodell, Czerwinski, Lis & Roscoe (2023). Learning engineering perspectives for supporting educational systems. *HFES* 67(1). [10.1177/21695067231192886](https://doi.org/10.1177/21695067231192886) | Links to human factors' design-documentation traditions; weaker. |

## 8. Identifying and collecting design data

| Source | Why it matters for Armature |
| --- | --- |
| Harden (2001). AMEE Guide 21: curriculum mapping. *Medical Teacher* 23(2). [10.1080/01421590120036547](https://doi.org/10.1080/01421590120036547) | "The essence of a curriculum map is not the nodes but the links." |
| Rowland (1993). Designing and instructional design. *ETR&D* 41. [10.1007/BF02297094](https://doi.org/10.1007/BF02297094) | Whether designers follow ID models, drawing on design research elsewhere. |
| Gray et al. (2015). Judgment and instructional design: how ID practitioners work in practice. *PIQ* 28(3). [10.1002/piq.21198](https://doi.org/10.1002/piq.21198) | Continuous, overlapping judgments: the unrecorded decisions Armature targets. |
| Demiral-Uzan & Boling (2024). Instructional design students' design judgment development. *ETR&D* 72. [10.1007/s11423-024-10361-1](https://doi.org/10.1007/s11423-024-10361-1) | Judgments are numerous and often unreflective; capture at the moment of change. |
| Stefaniak, Tawfik & Sentz (2023). Supporting dynamic instructional design decisions within a bounded rationality. *TechTrends* 67(2). [10.1007/s11528-022-00792-z](https://doi.org/10.1007/s11528-022-00792-z) | Design notes and findings can supply the analogues bounded designers lack. |
| Boling (2010). The need for design cases. *IJDL* 1(1). [10.14434/ijdl.v1i1.919](https://doi.org/10.14434/ijdl.v1i1.919) | Design cases rebuild decisions from memory; Armature history is their raw material. |
| Lachheb & Boling (2018). Design tools in practice. *JCHE* 30(1). [10.1007/s12528-017-9165-x](https://doi.org/10.1007/s12528-017-9165-x) | Designers use a scattered mix of tools; no system of record exists. |
| Sugar & Moore (2015). Documenting current instructional design practices. *JAID* 5(1). [link](https://digitalcommons.odu.edu/stemps_fac_pubs/104) | A year-long designer activity log used as research data. |
| Agostinho (2009). Learning design representations to document, model, and share teaching practice. *Handbook of Research on Learning Design and Learning Objects*. [link](https://ro.uow.edu.au/edupapers/957) | Compares six representations; no standard exists. |
| Albó, Barria-Pineda, Brusilovsky & Hernández-Leo (2022). Knowledge-based design analytics for authoring courses with smart learning content. *IJAIED* 32(1). [10.1007/s40593-021-00253-3](https://doi.org/10.1007/s40593-021-00253-3) | Design analytics inside an authoring tool reduced errors: precedent for Narrative 2. |
