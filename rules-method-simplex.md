## MÉTODO SIMPLEX

|                 | Maximización                                                                                                       | Minimización                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Columna Pivote  | Es el valor mayor negativo en la fila de Z, menos la primera y última columna                                      | El número mayor en la fila de Z, menos la primera y última columna                                                |
| Fila pivote     | El número más pequeño (división de la columna pivote con la columna solución), no entra los ceros ni los negativos | El número más pequeño (división de la columna pivote con la columna solución),no entra los ceros ni los negativos |
| Punto de parada | Cuando todos los valores son ceros y positivos                                                                     | Cuando todos los valores son ceros y negativos                                                                    |

#### VARIABLES QUE SE DEBEN AGREGAR A LAS RESTRICCIONES

Sea: 𝑅𝑖 =𝑉𝑎𝑟𝑖𝑎𝑏𝑙𝑒 𝐴𝑟𝑡𝑖𝑓𝑖𝑐𝑖𝑎𝑙 y 𝑆𝑖 =𝑉𝑎𝑟𝑖𝑎𝑏𝑙𝑒 𝑑𝑒 𝐻𝑜𝑙𝑔𝑢𝑟𝑎 donde 𝑖= 1 , 2 , 3 .....

| Restricción | Variables a agregar | Significado                                            |
| ----------- | ------------------- | ------------------------------------------------------ |
| ≥           | +𝑅𝑖 ,−𝑆𝑖            | sumar variable artificial y restar variable de holgura |
| ≤           | +𝑆𝑖                 | sumar variable de holgura                              |
| =           | +𝑅𝑖                 | sumar variable artificial                              |

#### FÓRMULA PARA ACTUALIZAR LOS NUEVOS DATOS DE LA FILA

𝑭𝒊𝒍𝒂 𝒂𝒄𝒕𝒖𝒂𝒍−(𝑬𝒍𝒆𝒎𝒆𝒕𝒐 𝒑𝒊𝒗𝒐𝒕𝒆 𝒅𝒆 𝒍𝒂 c𝒐𝒍𝒖𝒎𝒏𝒂∗𝑵𝒖𝒆𝒗𝒂 𝒇𝒊𝒍𝒂)
